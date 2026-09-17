import { beforeEach, describe, expect, it, vi } from 'vitest';

// The global setup mocks p-queue with immediate execution. Unmock it here
// to exercise real concurrency.
vi.unmock('p-queue');

import { runWithConcurrency } from './runWithConcurrency';
import { CancellationError } from '@/errors';

describe('runWithConcurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('rejects with CancellationError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const task1 = vi.fn(async () => 'result1');

    await expect(
      runWithConcurrency([task1], {
        concurrency: 2,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CancellationError);

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

        await new Promise((resolve) => setTimeout(resolve, duration));

        activeCount--;
        return `done-${duration}`;
      };
    };

    const tasks = [
      createTask(50),
      createTask(100),
      createTask(150),
      createTask(200),
      createTask(250),
    ];

    const results = await runWithConcurrency(tasks, {
      concurrency: 2,
      signal: null as unknown as AbortSignal,
    });

    expect(results).toHaveLength(5);

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
});
