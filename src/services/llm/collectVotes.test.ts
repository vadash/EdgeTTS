import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectVotes, spreadTemps } from './collectVotes';

describe('collectVotes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gathers need successes, refills failures with unused temps, never over-subscribes', async () => {
    const need = 5;
    const parallel = 3;
    // 15 temps: the first 2 always fail, the rest succeed.
    const temps = Array.from({ length: 15 }, (_, i) => i);

    const seen: number[] = [];
    let live = 0;
    let peakLive = 0;

    const run = vi.fn(async (temp: number) => {
      live++;
      peakLive = Math.max(peakLive, live);
      seen.push(temp);
      // Yield so the worker loop re-checks the quota between attempts.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      live--;
      // Failing temps: 0 and 1. Everything else succeeds.
      if (temp < 2) return null;
      return [temp];
    });

    const pending = collectVotes<number[]>({ need, parallel, temps, run });
    await vi.runAllTimersAsync();
    const results = await pending;

    // Exactly `need` successes.
    expect(results).toHaveLength(need);

    // Every temp handed to run was unique (the core invariant: no same-temp retry).
    expect(new Set(seen).size).toBe(seen.length);

    // Failures were replaced: more attempts than successes.
    expect(run).toHaveBeenCalledTimes(seen.length);
    expect(seen.length).toBeGreaterThan(need);

    // Never exceeded the parallel cap.
    expect(peakLive).toBeLessThanOrEqual(parallel);

    // All returned results came from succeeding temps.
    for (const r of results) {
      expect(r[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns all successes when budget runs out before need is met', async () => {
    // Temps 0 and 1 fail; 3 and 4 succeed. need=5 but budget has only 2 winners.
    const failTemps = new Set([0, 1]);
    const run = vi.fn(async (temp: number) => (failTemps.has(temp) ? null : [temp]));
    const pending = collectVotes({
      need: 5,
      parallel: 2,
      temps: [0, 1, 3, 4],
      run,
    });
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(results).toEqual([[3], [4]]);
    expect(run).toHaveBeenCalledTimes(4); // every temp tried exactly once
  });

  it('rejects on already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const run = vi.fn(async () => [0]);
    await expect(
      collectVotes({ need: 1, parallel: 1, temps: [0], run, signal: ac.signal }),
    ).rejects.toThrow('Operation cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('need <= 0 returns empty', async () => {
    const run = vi.fn(async () => [0]);
    const results = await collectVotes({ need: 0, parallel: 2, temps: [0, 1], run });
    expect(results).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('spreadTemps', () => {
  it('produces count distinct temps within [min, max]', () => {
    const temps = spreadTemps(8, 0.2, 0.8);
    expect(temps).toHaveLength(8);
    expect(new Set(temps).size).toBe(8);
    for (const t of temps) {
      expect(t).toBeGreaterThanOrEqual(0.2);
      expect(t).toBeLessThanOrEqual(0.8);
    }
  });

  it('rounds to two decimals', () => {
    const temps = spreadTemps(5);
    for (const t of temps) {
      expect(Math.round(t * 100) / 100).toBe(t);
    }
  });

  it('single temp equals min', () => {
    expect(spreadTemps(1, 0.3, 0.9)).toEqual([0.3]);
  });
});
