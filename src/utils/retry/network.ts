import { getCooldownRemainingMs } from '@/services/llm/rateLimitGate';

import pRetry from 'p-retry';
import { CancellationError, isRetriableError, throwIfAborted } from '@/errors';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  shouldRetry?: (error: unknown) => boolean;
  signal?: AbortSignal;
}

/**
 * Repo rule: every network call goes through this helper (AGENTS.md,
 * Boundaries). The defaults handle network jitter, sleep mode recovery,
 * and rate limiting.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 2000,
    maxDelay = 60000,
    onRetry,
    shouldRetry = isRetriableError,
    signal,
  } = options;

  // p-retry doesn't support Infinity, use MAX_SAFE_INTEGER instead
  const retries = maxRetries === Infinity ? Number.MAX_SAFE_INTEGER : maxRetries;

  try {
    return await pRetry(
      async () => {
        throwIfAborted(signal);
        return operation();
      },
      {
        retries,
        // When a 429 cooldown is in flight, the rate-limit gate inside the
        // operation already waited the provider's full deadline. p-retry must
        // not stack its own backoff on top, because its timers cap at maxDelay
        // (60s) and would only delay the next attempt pointlessly. Zero the
        // timers so the gate owns the wait and the retry resumes the instant
        // the cooldown releases.
        minTimeout: getCooldownRemainingMs() > 0 ? 0 : baseDelay,
        maxTimeout: getCooldownRemainingMs() > 0 ? 0 : maxDelay,
        factor: 2,
        randomize: true, // Jitter prevents a thundering herd of retries
        signal,
        onFailedAttempt: (context) => {
          const actualError = context.error;

          if (shouldRetry && !shouldRetry(actualError)) {
            // A throw here makes p-retry stop retrying.
            throw actualError;
          }

          // The delay here only feeds the onRetry callback. p-retry applies
          // its own backoff.
          const jitter = Math.random() * 1000;
          const nextDelay = Math.min(
            baseDelay * 2 ** (context.attemptNumber - 1) + jitter,
            maxDelay,
          );

          onRetry?.(context.attemptNumber, actualError, nextDelay);
        },
      },
    );
  } catch (error) {
    // When the signal fires mid-flight (e.g. during backoff), p-retry rejects
    // with the signal's own abort reason instead of our error. Translate that
    // window once here so cancellation has a single encoding (ADR 0017).
    if (signal?.aborted && !(error instanceof CancellationError)) {
      throw new CancellationError();
    }
    throw error;
  }
}
