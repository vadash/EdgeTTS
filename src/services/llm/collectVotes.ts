/**
 * Gather N successful votes by keeping a pool of concurrent attempts full,
 * each attempt at a distinct temperature.
 *
 * A failed attempt is replaced by an unused temperature from the budget:
 * retrying the temperature that just timed out is the least likely value to
 * succeed, and serial retries add the full per-attempt timeout to the wall
 * clock on every failure.
 *
 * Once the quota fills, every still-running attempt is aborted: their results
 * would be dropped anyway, and leaving them in flight burns wall clock and
 * provider quota (which is what earns the next 429).
 *
 * Two auth-class failures (401/403) abort the pool immediately: replacement
 * temperatures cannot fix a rejected key (ADR 0020). Only a success resets
 * the count, so timeouts interleaved between 403s cannot stall the latch.
 *
 * The rate-limit gate is not wired in here on purpose: `LLMApiClient`
 * already calls `waitTurn` per request, so a 429 parks every in-flight
 * attempt for the provider's cooldown.
 */

import { isFailureClass, throwIfAborted } from '@/errors';

export interface CollectVotesOptions<T> {
  /** Successful votes required. */
  need: number;
  /** Max attempts in flight. */
  parallel: number;
  /** Distinct temperatures to draw from; the count is also the attempt budget. */
  temps: number[];
  /** One attempt. Returns null (or throws) on failure. Aborted once `need` lands. */
  run: (temp: number, signal: AbortSignal) => Promise<T | null>;
  signal?: AbortSignal | null;
  /**
   * Called as each attempt settles, with the running success count and the
   * thrown error when the attempt failed by throwing.
   */
  onSettled?: (ok: boolean, temp: number, collected: number, error?: unknown) => void;
  /**
   * Called once when two auth-class failures abort the pool (ADR 0020); only
   * a success resets the count. `collected` is the vote count at that moment.
   */
  onAuthBurst?: (error: unknown, collected: number) => void;
}

/**
 * Runs attempts until `need` succeed, the temperature budget is exhausted, the
 * signal aborts, or an auth burst aborts the pool. Returns the successes in
 * completion order (may be shorter than `need` when the budget runs out).
 */
export async function collectVotes<T>(options: CollectVotesOptions<T>): Promise<T[]> {
  const { need, parallel, temps, run, signal, onSettled, onAuthBurst } = options;

  if (need <= 0 || temps.length === 0) {
    return [];
  }
  throwIfAborted(signal);

  const queue = [...temps];
  const results: T[] = [];

  // Cancels surplus attempts when the quota fills; also relays a caller abort
  // so `run` implementations only need to watch one signal.
  const pool = new AbortController();
  const relay = () => pool.abort();
  signal?.addEventListener('abort', relay, { once: true });

  // Two auth-class failures abort the pool: replacement temperatures cannot
  // spend their way out of a rejected key (ADR 0020). Only a success resets
  // the count, so timeouts interleaved between 403s cannot stall the latch.
  let authFailures = 0;
  let burstLatched = false;

  const worker = async (): Promise<void> => {
    while (results.length < need && !burstLatched) {
      throwIfAborted(signal);
      const temp = queue.shift();
      if (temp === undefined) {
        return;
      }

      let value: T | null = null;
      let thrownError: unknown;
      try {
        value = await run(temp, pool.signal);
      } catch (error) {
        value = null; // the caller logs; the pool only cares ok/failed
        thrownError = error;
        if (isFailureClass(error, 'auth')) {
          authFailures++;
          if (authFailures >= 2 && !burstLatched) {
            burstLatched = true;
            pool.abort();
            onAuthBurst?.(error, results.length);
            return;
          }
        }
        // A non-auth failure leaves the auth count alone: an outage mixed
        // into a string of 403s is still a rejected key.
      }

      // A late arrival after the quota filled is dropped rather than pushed,
      // so consensus always sees exactly `need` votes.
      if (results.length >= need) {
        return;
      }
      if (value !== null) {
        authFailures = 0; // only a success proves the key works again
        results.push(value);
        if (results.length >= need) {
          pool.abort(); // stop the losers; their results are unusable now
        }
      }
      // Workers aborted by the burst settle late; their settles must not
      // surface as "replacing with a fresh temperature" after the pool died.
      if (!burstLatched) {
        onSettled?.(value !== null, temp, results.length, thrownError);
      }
    }
  };

  const workers = Math.max(1, Math.min(parallel, temps.length));
  try {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    signal?.removeEventListener('abort', relay);
  }

  return results.slice(0, need);
}

/**
 * `count` distinct temperatures spread evenly across [min, max], shuffled so
 * consecutive runs don't always fire the same value first. Rounded to 2
 * decimals; `count` above ~60 would start colliding on the 0.1-0.7 range.
 */
export function spreadTemps(count: number, min = 0.1, max = 0.7): number[] {
  const step = count > 1 ? (max - min) / (count - 1) : 0;
  const temps = Array.from({ length: count }, (_, i) => Math.round((min + i * step) * 100) / 100);

  // Fisher-Yates
  for (let i = temps.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [temps[i], temps[j]] = [temps[j], temps[i]];
  }
  return temps;
}
