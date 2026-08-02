import { afterEach, beforeEach, describe, expect, vi } from 'vitest';

import {
  getCooldownRemainingMs,
  getLimit,
  isRateLimitError,
  noteError,
  noteRateLimit,
  noteSuccess,
  onLimitChange,
  parseRetryAfterMs,
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

  t('waitTurn rejects immediately if signal already aborted', async () => {
    noteRateLimit(120_000);
    const controller = new AbortController();
    controller.abort();
    await expect(waitTurn(controller.signal)).rejects.toThrow('Operation cancelled');
  });

  // parseRetryAfterMs ----------------------------------------------------

  t('parseRetryAfterMs reads retry-after-ms header', () => {
    const headers = new Headers({ 'retry-after-ms': '119000' });
    expect(parseRetryAfterMs({ headers })).toBe(119_000);
  });

  t('parseRetryAfterMs reads retry-after header (seconds)', () => {
    const headers = new Headers({ 'retry-after': '120' });
    expect(parseRetryAfterMs({ headers })).toBe(120_000);
  });

  t('parseRetryAfterMs reads retry-after-ms from a plain record header', () => {
    const headers = { 'retry-after-ms': '5000' } as const;
    expect(parseRetryAfterMs({ headers })).toBe(5_000);
  });

  t('parseRetryAfterMs extracts retry-after-ms=NNN from the wrapped message', () => {
    const err = {
      message:
        'LLM API call failed: 429 sidecar: pool z-ai/glm-5.2 rate-limited, circuit open retry-after-ms=119000',
      cause: { status: 429 },
    };
    expect(parseRetryAfterMs(err)).toBe(119_000);
  });

  t('parseRetryAfterMs walks the cause chain for an embedded deadline', () => {
    const err = {
      message: 'LLM API call failed: something broke',
      cause: { message: 'sidecar: circuit open retry-after-ms=60000' },
    };
    expect(parseRetryAfterMs(err)).toBe(60_000);
  });

  t('parseRetryAfterMs returns null when nothing is parseable', () => {
    expect(parseRetryAfterMs(new Error('Request timed out.'))).toBeNull();
    expect(parseRetryAfterMs({ message: '429 provider API error (status 429)' })).toBeNull();
  });

  // isRateLimitError -----------------------------------------------------

  t('isRateLimitError detects a raw 429 status', () => {
    expect(isRateLimitError({ status: 429, message: 'rate limited' })).toBe(true);
  });

  t('isRateLimitError detects 429 via the cause chain', () => {
    const err = { message: 'LLM API call failed: 429', cause: { status: 429 } };
    expect(isRateLimitError(err)).toBe(true);
  });

  t('isRateLimitError detects "429" in the wrapped message', () => {
    const err = new Error('LLM API call failed: 429 provider API error (status 429)');
    expect(isRateLimitError(err)).toBe(true);
  });

  t('isRateLimitError detects rate_limit_error type wording', () => {
    expect(isRateLimitError(new Error('rate_limit_error: too many requests'))).toBe(true);
  });

  t('isRateLimitError ignores unrelated errors', () => {
    expect(isRateLimitError(new Error('Request timed out.'))).toBe(false);
    expect(isRateLimitError(new Error('Empty response from LLM'))).toBe(false);
    expect(isRateLimitError({ status: 500, message: 'Server Error' })).toBe(false);
  });

  // noteError integration ------------------------------------------------

  t('noteError trips the gate on 429 and parses the deadline', () => {
    const err = {
      message: '429 sidecar: pool z-ai/glm-5.2 rate-limited, circuit open retry-after-ms=119000',
      cause: { status: 429 },
    };
    noteError(err);
    expect(getLimit()).toBe(1);
    expect(getCooldownRemainingMs()).toBeCloseTo(120_000, -2);
  });

  t('noteError is a no-op for non-rate-limit errors', () => {
    noteError(new Error('Request timed out.'));
    expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    expect(getCooldownRemainingMs()).toBe(0);
  });
});
