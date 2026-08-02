import type { ILogger } from '../Logger';

/**
 * Global adaptive rate-limit governor for LLM calls (AIMD).
 *
 * A 429 from the provider means the whole upstream pool is exhausted, so
 * retrying in parallel with exponential backoff only deepens the hole. The
 * only useful response is:
 *
 *  1. Collapse concurrency to 1 immediately.
 *  2. Park every caller until the server's own deadline (+1s safety margin).
 *  3. Resume single-file, then climb back one slot per clean call, stopping at
 *     the configured ceiling (`setCeiling`, i.e. the user's LLM threads).
 *
 * ponytail: one process-global gate, not keyed per provider/pool. A conversion
 * talks to a single upstream at a time; add a `Map<poolKey, state>` only if
 * multi-provider fan-out ever lands.
 */

/** Extra wait on top of the server deadline, so we never probe one tick early. */
const SAFETY_MARGIN_MS = 1000;
/** Cooldown used when the provider sends a 429 with no parseable deadline. */
const DEFAULT_COOLDOWN_MS = 60_000;
/** Guard against a bogus/hostile Retry-After wedging the app indefinitely. */
const MAX_COOLDOWN_MS = 10 * 60_000;
/** Consecutive successes required before opening one more slot. */
const SUCCESSES_PER_STEP = 1;
/** Ceiling used before a caller declares the configured one. */
const DEFAULT_CEILING = 32;

let cooldownUntil = 0;
let limit = Number.POSITIVE_INFINITY;
let ceiling = DEFAULT_CEILING;
let successStreak = 0;
const listeners = new Set<(limit: number) => void>();

/**
 * Declare the configured concurrency ceiling so recovery stops there instead of
 * climbing into headroom the caller will clamp away anyway — which logged
 * "raised to 19" while the queue was still pinned at the configured 15.
 */
export function setCeiling(next: number): void {
  const clipped = Math.max(1, Math.trunc(next));
  ceiling = clipped;
  // If a recovery left us above the new (lower) ceiling, snap down now rather
  // than burning a success streak on a climb that can't land in the queue.
  if (Number.isFinite(limit) && limit > clipped) {
    setLimit(clipped);
  }
}

/** Current allowed concurrency. `Infinity` until the first 429 is seen. */
export function getLimit(): number {
  return limit;
}

/** Milliseconds left on the current cooldown (0 when not rate-limited). */
export function getCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

/** Subscribe to concurrency-limit changes. Returns an unsubscribe function. */
export function onLimitChange(listener: (limit: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setLimit(next: number): void {
  if (next === limit) return;
  limit = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/** Test hook: restore pristine state between cases. */
export function resetRateLimitGate(): void {
  cooldownUntil = 0;
  successStreak = 0;
  limit = Number.POSITIVE_INFINITY;
  ceiling = DEFAULT_CEILING;
  listeners.clear();
}

/**
 * Extract the provider's requested wait in milliseconds.
 *
 * Handles, in order of trust: `retry-after-ms` / `retry-after` response
 * headers (OpenAI SDK exposes these on `APIError.headers`), then the same
 * fields embedded in the error message, which is how our sidecar reports
 * them (`... rate-limited, circuit open retry-after-ms=119000`).
 */
export function parseRetryAfterMs(error: unknown): number | null {
  const candidate = error as {
    headers?: Headers | Record<string, string>;
    message?: string;
  };

  const readHeader = (name: string): string | null => {
    const headers = candidate?.headers;
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string>;
    return record[name] ?? record[name.toLowerCase()] ?? null;
  };

  const headerMs = Number(readHeader('retry-after-ms'));
  if (Number.isFinite(headerMs) && headerMs > 0) return headerMs;

  const headerSeconds = Number(readHeader('retry-after'));
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds * 1000;

  // Walk the message and the cause chain for an embedded deadline.
  for (const message of collectMessages(error)) {
    const ms = /retry[-_ ]?after[-_ ]?ms["'\s]*[=:]\s*["']?(\d+)/i.exec(message);
    if (ms) return Number(ms[1]);
    const seconds = /retry[-_ ]?after["'\s]*[=:]\s*["']?(\d+)/i.exec(message);
    if (seconds) return Number(seconds[1]) * 1000;
  }

  return null;
}

/** Collect messages from an error and its `cause` chain (depth-capped). */
function collectMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const node = current as { message?: string; cause?: unknown };
    if (typeof node.message === 'string') messages.push(node.message);
    current = node.cause;
  }
  return messages;
}

/**
 * Detect a rate-limit rejection. Checks the HTTP status when the SDK error is
 * intact, and otherwise falls back to the wrapped message, because
 * `LLMApiClient` re-throws as `RetriableError('LLM API call failed: ...')`.
 */
export function isRateLimitError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const node = current as { status?: number; cause?: unknown };
    if (node.status === 429) return true;
    current = node.cause;
  }

  return collectMessages(error).some((message) => {
    if (/\b429\b/.test(message)) return true;
    const lower = message.toLowerCase();
    return (
      lower.includes('rate_limit') || lower.includes('rate-limit') || lower.includes('rate limit')
    );
  });
}

/** Inspect a failure and trip the gate when it is a rate limit. */
export function noteError(error: unknown, logger?: ILogger): void {
  if (!isRateLimitError(error)) return;
  noteRateLimit(parseRetryAfterMs(error), logger);
}

/**
 * Trip the gate: collapse concurrency to 1 and park callers until the
 * deadline. Never shortens an active cooldown, so overlapping 429s from a
 * fan-out converge on the longest deadline instead of racing it down.
 */
export function noteRateLimit(retryAfterMs: number | null, logger?: ILogger): void {
  const requested = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : DEFAULT_COOLDOWN_MS;
  const waitMs = Math.min(requested, MAX_COOLDOWN_MS) + SAFETY_MARGIN_MS;
  const deadline = Date.now() + waitMs;

  setLimit(1);
  successStreak = 0;

  // Only the caller that extends the deadline logs, so N parked workers
  // don't reproduce the log flood this gate exists to prevent.
  if (deadline <= cooldownUntil) return;
  cooldownUntil = deadline;
  logger?.warn(
    `[ratelimit] 429 from provider — concurrency dropped to 1, pausing ${Math.round(waitMs / 1000)}s`,
  );
}

/** Record a success; climbs one slot per `SUCCESSES_PER_STEP` clean calls. */
export function noteSuccess(logger?: ILogger): void {
  if (limit === Number.POSITIVE_INFINITY) return;
  successStreak++;
  if (successStreak < SUCCESSES_PER_STEP) return;
  successStreak = 0;
  if (limit >= ceiling) return;
  setLimit(Math.min(limit + 1, ceiling));
  logger?.info(`[ratelimit] recovered — concurrency raised to ${limit}`);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Operation cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
/**
 * Block until the current cooldown expires. Loops because a concurrent 429
 * may extend the deadline while we are already waiting.
 */
export async function waitTurn(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw new Error('Operation cancelled');
  while (true) {
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) return;
    await sleep(remaining, signal);
  }
}
