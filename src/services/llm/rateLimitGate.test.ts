import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { ZodError } from 'zod';

import { CancellationError, RetriableError } from '@/errors';

import {
  getCooldownRemainingMs,
  getLimit,
  noteError,
  noteRateLimit,
  noteSuccess,
  onLimitChange,
  resetRateLimitGate,
  setCeiling,
  waitTurn,
} from './rateLimitGate';

describe('rateLimitGate', (t) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    resetRateLimitGate();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  t('unrestricted until the first 429', () => {
    expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    expect(getCooldownRemainingMs()).toBe(0);
  });

  t('waitTurn is a no-op when not rate-limited', async () => {
    await expect(waitTurn(null)).resolves.toBeUndefined();
  });

  t('429 collapses concurrency to 1', () => {
    noteRateLimit(60_000);
    expect(getLimit()).toBe(1);
  });

  t('cooldown duration is retryAfterMs + 1s safety margin', async () => {
    noteRateLimit(119_000);
    // Exactly 119999ms in: still throttled.
    vi.advanceTimersByTime(119_999);
    expect(getCooldownRemainingMs()).toBe(1);
    // One more ms: cooldown elapsed.
    vi.advanceTimersByTime(1);
    expect(getCooldownRemainingMs()).toBe(0);
    await expect(waitTurn(null)).resolves.toBeUndefined();
  });

  t('waitTurn parks until retryAfterMs + 1s elapses', async () => {
    noteRateLimit(1000);
    let settled = false;
    waitTurn(null).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  t('overlapping noteRateLimit never shortens an active cooldown', () => {
    noteRateLimit(60_000);
    const firstDeadline = getCooldownRemainingMs();
    vi.advanceTimersByTime(5_000);
    // Second 429 with a shorter wait must not pull the deadline earlier.
    noteRateLimit(1_000);
    expect(getCooldownRemainingMs()).toBeGreaterThan(firstDeadline - 5_000 - 1_000);
    expect(getLimit()).toBe(1);
  });

  t('overlapping noteRateLimit extends to the longer deadline', () => {
    noteRateLimit(60_000);
    // While 60s still active, a 120s 429 arrives: deadline must extend to ~121s.
    noteRateLimit(120_000);
    expect(getCooldownRemainingMs()).toBeGreaterThan(120_000);
  });

  t('default cooldown used when no retry-after is parseable', async () => {
    noteRateLimit(null);
    // 60s default + 1s margin
    vi.advanceTimersByTime(60_999);
    let settled = false;
    waitTurn(null).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  t('bogus retry-after is clamped to the 10-minute ceiling', () => {
    noteRateLimit(99 * 60_000);
    // 10 min + 1s, not 99 min
    expect(getCooldownRemainingMs()).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });
  t('climbs one slot per clean call after a 429', () => {
    noteRateLimit(0); // -> limit 1
    expect(getLimit()).toBe(1);
    noteSuccess();
    expect(getLimit()).toBe(2);
    noteSuccess();
    expect(getLimit()).toBe(3);
  });

  t('recovers to the configured ceiling and stops', () => {
    setCeiling(15);
    noteRateLimit(0); // -> limit 1
    for (let i = 0; i < 20; i++) noteSuccess();
    expect(getLimit()).toBe(15);
  });

  t('setCeiling snaps a live limit above the new ceiling down', () => {
    setCeiling(32);
    noteRateLimit(0);
    for (let i = 0; i < 10; i++) noteSuccess(); // -> limit 11
    expect(getLimit()).toBe(11);
    setCeiling(5);
    expect(getLimit()).toBe(5);
  });

  t('successes are ignored while unrestricted', () => {
    noteSuccess();
    noteSuccess();
    noteSuccess();
    expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
  });

  t('successes reset the streak on a subsequent 429', () => {
    noteRateLimit(1_000);
    noteSuccess();
    noteRateLimit(1_000); // streak reset
    noteSuccess();
    expect(getLimit()).toBe(2);
  });

  t('onLimitChange fires when the limit moves', () => {
    const listener = vi.fn();
    onLimitChange(listener);
    noteRateLimit(1_000);
    expect(listener).toHaveBeenLastCalledWith(1);
    noteSuccess();
    expect(listener).toHaveBeenLastCalledWith(2);
  });

  t('onLimitChange unsubscribe stops callbacks', () => {
    const listener = vi.fn();
    const off = onLimitChange(listener);
    off();
    noteRateLimit(1_000);
    expect(listener).not.toHaveBeenCalled();
  });

  t('waitTurn aborts promptly on signal', async () => {
    noteRateLimit(120_000);
    const controller = new AbortController();
    let rejected = false;
    waitTurn(controller.signal).catch(() => {
      rejected = true;
    });
    controller.abort();
    // Flush the rejection microtask (abort fires async).
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBe(true);
  });

  t('waitTurn rejects with CancellationError if signal already aborted', async () => {
    noteRateLimit(120_000);
    const controller = new AbortController();
    controller.abort();
    await expect(waitTurn(controller.signal)).rejects.toBeInstanceOf(CancellationError);
  });

  // noteError integration ------------------------------------------------

  t('noteError trips the gate on a tagged 429 and honors the deadline', () => {
    noteError(
      new RetriableError('LLM API call failed: 429', undefined, {
        kind: 'rate-limit',
        retryAfterMs: 119_000,
      }),
    );
    expect(getLimit()).toBe(1);
    expect(getCooldownRemainingMs()).toBeCloseTo(120_000, -2);
  });

  t('noteError is a no-op for non-RetriableError errors', () => {
    noteError(new Error('Request timed out.'));
    expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    expect(getCooldownRemainingMs()).toBe(0);
  });

  t('noteError trips the gate on a tagged network-down for a 1-minute probe', () => {
    noteError(new RetriableError('LLM API call failed: 502', undefined, { kind: 'network-down' }));
    expect(getLimit()).toBe(1);
    expect(getCooldownRemainingMs()).toBeGreaterThan(60_000);
  });

  t('noteError ignores untagged and data-quality errors', () => {
    noteError(new RetriableError('Request timed out.'));
    noteError(new RetriableError('Empty response from LLM', undefined, { kind: 'data' }));
    noteError(new ZodError([]));
    expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    expect(getCooldownRemainingMs()).toBe(0);
  });
});
