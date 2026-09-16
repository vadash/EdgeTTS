import { describe, expect, it, vi } from 'vitest';

import { CancellationError } from '@/errors';

import { withRetry } from './network';

describe('withRetry cancellation', () => {
  it('translates an abort-during-operation rejection into CancellationError', async () => {
    // The signal fires while the operation is in flight (p-retry's
    // abort-during-backoff window): whatever non-cancellation error p-retry
    // rejects with must surface as the one canonical encoding (ADR 0017).
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
