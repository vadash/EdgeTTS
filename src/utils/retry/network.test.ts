import { describe, expect, it, vi } from 'vitest';

import { CancellationError, RetriableError } from '@/errors';

import { withRetry } from './network';

// The global test setup replaces p-retry with a run-once stub; these tests
// assert retry counts, so restore the real scheduler for this file only.
vi.mock('p-retry', async (importOriginal) => importOriginal());

describe('withRetry cancellation', () => {
  it('translates an abort-during-operation rejection into CancellationError', async () => {
    // The signal fires while the operation is in flight, inside p-retry's
    // abort-during-backoff window. Whatever non-cancellation error p-retry
    // rejects with must surface as CancellationError, the canonical
    // cancellation encoding (ADR 0017).
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      controller.abort();
      throw new Error('boom');
    });

    await expect(
      withRetry(operation, { signal: controller.signal, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(CancellationError);
  });

  it('rejects with CancellationError before the first attempt when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => 'unused');

    await expect(withRetry(operation, { signal: controller.signal })).rejects.toBeInstanceOf(
      CancellationError,
    );
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('withRetry error classes', () => {
  it('spends zero retries on a deterministic failure', async () => {
    const operation = vi.fn(async () => {
      throw new RetriableError('provider rejected the request', undefined, {
        errorClass: 'deterministic',
      });
    });

    await expect(
      withRetry(operation, { maxRetries: 3, baseDelay: 1, maxDelay: 2 }),
    ).rejects.toThrow('provider rejected the request');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('keeps the retry ladder for transport-class failures', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new RetriableError('gateway blip', undefined, { errorClass: 'transport' }),
      )
      .mockResolvedValueOnce('recovered');

    await expect(withRetry(operation, { maxRetries: 3, baseDelay: 1, maxDelay: 2 })).resolves.toBe(
      'recovered',
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
