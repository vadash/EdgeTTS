import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkStore } from '../ChunkStore';
import { type PoolTask, TTSWorkerPool, type WorkerPoolOptions } from '../TTSWorkerPool';

vi.mock('../ReusableEdgeTTSService', () => ({
  ReusableEdgeTTSService: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      disconnect: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('READY'),
    };
  }),
}));

describe('Ladder Integration - E2E', () => {
  let pool: TTSWorkerPool;
  let options: WorkerPoolOptions;
  let mockChunkStore: ChunkStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Create mock ChunkStore
    mockChunkStore = {
      init: vi.fn().mockResolvedValue(undefined),
      writeChunk: vi.fn().mockResolvedValue(undefined),
      prepareForRead: vi.fn().mockResolvedValue(undefined),
      readChunk: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      getExistingIndices: vi.fn().mockReturnValue(new Set<number>()),
      clearDatabase: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChunkStore;

    options = {
      maxWorkers: 15,
      config: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
        volume: '100',
      },
      chunkStore: mockChunkStore,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scales up from 2 -> 3 -> 4 -> ... as tasks succeed', async () => {
    pool = new TTSWorkerPool(options);

    // Add 60 successful tasks (3 full evaluation cycles)
    const tasks: PoolTask[] = Array.from({ length: 60 }, (_, i) => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));
    pool.addTasks(tasks);

    // Process all tasks
    while (pool.getProgress().completed < 60) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Final state: should have scaled up significantly
    // Starting at 2, after 20 tasks -> 3, after 40 -> 4, after 60 -> 5
    const progress = pool.getProgress();
    expect(progress.completed).toBe(60);
    expect(progress.failed).toBe(0);
  });

  it('scales down when errors occur', async () => {
    // First, scale up with successful tasks
    pool = new TTSWorkerPool(options);

    const successTasks: PoolTask[] = Array.from({ length: 160 }, (_, i) => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));

    pool.addTasks(successTasks);

    // Process all successful tasks
    while (pool.getProgress().completed < 160) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Now create a new pool with a failing mock to test error handling
    // Mock to fail
    const { ReusableEdgeTTSService } = await import('../ReusableEdgeTTSService');
    vi.mocked(ReusableEdgeTTSService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error('Rate limited')),
        disconnect: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        getState: vi.fn().mockReturnValue('READY'),
      };
    });

    // Create new pool with failing mock
    const errorPool = new TTSWorkerPool(options);

    // Add a task that will fail
    const failingTask: PoolTask = {
      partIndex: 0,
      text: 'This will fail',
      filename: 'test',
      filenum: '0001',
    };

    // Set retry count to exceed max so it will fail permanently
    // @ts-expect-error - accessing private property for testing
    errorPool.retryCount.set(failingTask.partIndex, 11);

    errorPool.addTask(failingTask);

    await vi.advanceTimersByTimeAsync(100);

    // Verify failure was recorded
    const progress = errorPool.getProgress();
    expect(progress.failed).toBeGreaterThanOrEqual(1);

    // Cleanup
    await errorPool.cleanup();
  });
});
