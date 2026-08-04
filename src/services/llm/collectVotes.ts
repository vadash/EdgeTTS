/**
 * Gather N successful votes by keeping a pool of concurrent attempts full,
 * each attempt at a distinct temperature.
 *
 * Replaces the old sequential "vote, retry same temp on failure" loop: a
 * 4-minute timeout used to cost 4 minutes of wall clock per retry, serially,
 * and re-sending the temperature that just timed out is the least likely
 * value to succeed. Here a failure is replaced by an unused temperature from
 * the budget, so the pool stays busy until `need` votes land.
 *
 * The rate-limit gate is not wired in here on purpose: `LLMApiClient`
 * already calls `waitTurn` per request, so a 429 parks every in-flight
 * attempt for the provider's cooldown.
 */

export interface CollectVotesOptions<T> {
  /** Successful votes required. */
  need: number;
  /** Max attempts in flight. */
  parallel: number;
  /** Distinct temperatures to draw from — also the attempt budget. */
  temps: number[];
  /** One attempt. Returns null (or throws) on failure. */
  run: (temp: number) => Promise<T | null>;
  signal?: AbortSignal | null;
  /** Called as each attempt settles, with the running success count. */
  onSettled?: (ok: boolean, temp: number, collected: number) => void;
}

/**
 * Runs attempts until `need` succeed, the temperature budget is exhausted, or
 * the signal aborts. Returns the successes in completion order (may be
 * shorter than `need` when the budget runs out).
 */
export async function collectVotes<T>(options: CollectVotesOptions<T>): Promise<T[]> {
  const { need, parallel, temps, run, signal, onSettled } = options;

  if (need <= 0 || temps.length === 0) {
    return [];
  }
  if (signal?.aborted) {
    throw new Error('Operation cancelled');
  }

  const queue = [...temps];
  const results: T[] = [];

  const worker = async (): Promise<void> => {
    while (results.length < need) {
      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }
      const temp = queue.shift();
      if (temp === undefined) {
        return; // budget exhausted
      }

      let value: T | null = null;
      try {
        value = await run(temp);
      } catch {
        value = null; // the caller logs; the pool only cares ok/failed
      }

      // A late arrival after the quota filled is dropped rather than pushed,
      // so consensus always sees exactly `need` votes.
      if (results.length >= need) {
        return;
      }
      if (value !== null) {
        results.push(value);
      }
      onSettled?.(value !== null, temp, results.length);
    }
  };

  const workers = Math.max(1, Math.min(parallel, temps.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

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
