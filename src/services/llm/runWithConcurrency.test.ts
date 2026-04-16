import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unmock p-queue for this test file to test real concurrency behavior
vi.unmock('p-queue');

import { runWithConcurrency } from './runWithConcurrency';

describe('runWithConcurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results for empty task array', async () => {
    const results = await runWithConcurrency([], {
      concurrency: 2,
      signal: null as unknown as AbortSignal,
    });

    expect(results).toEqual([]);
  });

  it('executes all tasks and returns results in input order', async () => {
    const task1 = vi.fn(async () => 'result1');
    const task2 = vi.fn(async () => 'result2');
    const task3 = vi.fn(async () => 'result3');

    const results = await runWithConcurrency([task1, task2, task3], {
      concurrency: 2,
      signal: null as unknown as AbortSignal,
    });

    expect(results).toEqual(['result1', 'result2', 'result3']);
    expect(task1).toHaveBeenCalledTimes(1);
    expect(task2).toHaveBeenCalledTimes(1);
    expect(task3).toHaveBeenCalledTimes(1);
  });

  it('calls onProgress with correct completed/total values', async () => {
    const onProgress = vi.fn();
    const task1 = vi.fn(async () => 'result1');
    const task2 = vi.fn(async () => 'result2');
    const task3 = vi.fn(async () => 'result3');

    await runWithConcurrency([task1, task2, task3], {
      concurrency: 2,
      signal: null as unknown as AbortSignal,
      onProgress,
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
  });

  it('throws Operation cancelled when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const task1 = vi.fn(async () => 'result1');

    await expect(
      runWithConcurrency([task1], {
        concurrency: 2,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Operation cancelled');

    expect(task1).not.toHaveBeenCalled();
  });

  it('rejects with error when a task throws', async () => {
    const task1 = vi.fn(async () => 'result1');
    const task2 = vi.fn(async () => {
      throw new Error('Task failed');
    });
    const task3 = vi.fn(async () => 'result3');

    await expect(
      runWithConcurrency([task1, task2, task3], {
        concurrency: 2,
        signal: null as unknown as AbortSignal,
      }),
    ).rejects.toThrow('Task failed');

    expect(task1).toHaveBeenCalled();
    expect(task2).toHaveBeenCalled();
    // task3 may or may not have been called depending on timing
  });

  it('respects concurrency limit - no more than concurrency tasks run simultaneously', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    const createTask = (duration: number) => {
      return async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, duration));

        activeCount--;
        return `done-${duration}`;
      };
    };

    const tasks = [
      createTask(50), // will finish first
      createTask(100), // will finish second
      createTask(150), // will finish third
      createTask(200), // will finish fourth
      createTask(250), // will finish fifth
    ];

    const results = await runWithConcurrency(tasks, {
      concurrency: 2,
      signal: null as unknown as AbortSignal,
    });

    // Verify all tasks completed
    expect(results).toHaveLength(5);

    // Verify concurrency limit was respected
    // With concurrency: 2, we should never have more than 2 tasks running at once
    expect(maxActiveCount).toBeLessThanOrEqual(2);
  });

  it('respects concurrency limit of 1 (sequential execution)', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    const createTask = (duration: number) => {
      return async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);

        await new Promise((resolve) => setTimeout(resolve, duration));

        activeCount--;
        return `done-${duration}`;
      };
    };

    const tasks = [createTask(20), createTask(20), createTask(20)];

    const results = await runWithConcurrency(tasks, {
      concurrency: 1,
      signal: null as unknown as AbortSignal,
    });

    expect(results).toHaveLength(3);
    expect(maxActiveCount).toBeLessThanOrEqual(1);
  });

  it('respects higher concurrency limit', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const executionOrder: number[] = [];

    const createTask = (id: number, duration: number) => {
      return async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        executionOrder.push(id);

        await new Promise((resolve) => setTimeout(resolve, duration));

        activeCount--;
        return `done-${id}`;
      };
    };

    // With concurrency: 3 and 5 tasks where first 3 finish quickly,
    // we should see tasks 4 and 5 start before tasks 1-3 finish
    const tasks = [
      createTask(1, 100), // starts, runs for 100ms
      createTask(2, 100), // starts, runs for 100ms
      createTask(3, 100), // starts, runs for 100ms
      createTask(4, 50), // should start after one of first 3 finishes
      createTask(5, 50), // should start after another of first 3 finishes
    ];

    const results = await runWithConcurrency(tasks, {
      concurrency: 3,
      signal: null as unknown as AbortSignal,
    });

    expect(results).toHaveLength(5);
    // With concurrency 3, we should never have more than 3 tasks running at once
    expect(maxActiveCount).toBeLessThanOrEqual(3);
  });
});
