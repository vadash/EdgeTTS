// Network retry utilities with exponential backoff

import pRetry, { AbortError } from 'p-retry';
import { isRetriableError } from '@/errors';

export { AbortError };

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  shouldRetry?: (error: unknown) => boolean;
  signal?: AbortSignal;
}

/**
 * Executes a function with exponential backoff retry logic.
 * Handles network jitters, sleep mode recovery, and rate limiting.
 * Uses p-retry internally for battle-tested retry behavior.
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

  return pRetry(
    async (_attemptNumber) => {
      // Check for cancellation before each attempt
      if (signal?.aborted) {
        throw new AbortError('Operation cancelled');
      }
      return operation();
    },
    {
      retries,
      minTimeout: baseDelay,
      maxTimeout: maxDelay,
      factor: 2, // Exponential backoff factor
      randomize: true, // Adds jitter to prevent thundering herd
      signal,
      onFailedAttempt: (context) => {
        // p-retry 7.x passes a context object {error, attemptNumber, retriesLeft, ...}
        const actualError = context.error;

        // Check if error should be retried
        if (shouldRetry && !shouldRetry(actualError)) {
          throw actualError; // Don't retry - rethrow to stop
        }

        // Calculate delay for callback (p-retry handles actual delay)
        const jitter = Math.random() * 1000;
        const nextDelay = Math.min(baseDelay * 2 ** (context.attemptNumber - 1) + jitter, maxDelay);

        onRetry?.(context.attemptNumber, actualError, nextDelay);
      },
    },
  );
}
