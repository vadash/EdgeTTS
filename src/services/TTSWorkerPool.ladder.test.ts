import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkStore } from './ChunkStore';
import { type PoolTask, TTSWorkerPool, type WorkerPoolOptions } from './TTSWorkerPool';

vi.mock('./ReusableEdgeTTSService', () => ({
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

describe('TTSWorkerPool - Ladder Integration', () => {
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
      maxWorkers: 10,
      config: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
        volume: '100%',
      },
      chunkStore: mockChunkStore,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warmup uses ladder workers (3), not maxWorkers', async () => {
    pool = new TTSWorkerPool(options);

    // Spy on connectionPool.acquire
    const acquireSpy = vi.spyOn(
      (pool as unknown as Record<string, unknown>).connectionPool as {
        acquire: () => Promise<unknown>;
      },
      'acquire',
    );

    await pool.warmup();

    // Should warm up 3 connections (ladder minWorkers), not 10
    expect(acquireSpy).toHaveBeenCalledTimes(3);
  });

  it('has ladder controller instance', async () => {
    pool = new TTSWorkerPool(options);

    // Check that ladder exists internally
    expect((pool as unknown as Record<string, unknown>).ladder).toBeDefined();
    expect(
      (
        (pool as unknown as Record<string, unknown>).ladder as {
          getCurrentWorkers: () => number;
        }
      ).getCurrentWorkers(),
    ).toBe(3);
  });

  it('records successful task for ladder evaluation', async () => {
    pool = new TTSWorkerPool(options);

    const task: PoolTask = {
      partIndex: 0,
      text: 'Test text',
      filename: 'test',
      filenum: '0001',
    };

    pool.addTask(task);

    // Wait for task to process
    await vi.advanceTimersByTimeAsync(100);

    const progress = pool.getProgress();
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(0);
  });

  it('records intermediate failures to ladder for immediate throttling', async () => {
    // Mock send to fail
    const { ReusableEdgeTTSService } = await import('./ReusableEdgeTTSService');
    vi.mocked(ReusableEdgeTTSService).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error('Rate limited')),
        disconnect: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        getState: vi.fn().mockReturnValue('READY'),
      };
    });

    pool = new TTSWorkerPool(options);

    // Spy on ladder methods
    const ladder = (pool as unknown as Record<string, unknown>).ladder as {
      recordTask: (success: boolean, retries: number) => void;
      evaluate: () => void;
      getCurrentWorkers: () => number;
    };
    const recordTaskSpy = vi.spyOn(ladder, 'recordTask');
    const evaluateSpy = vi.spyOn(ladder, 'evaluate');

    const task: PoolTask = {
      partIndex: 0,
      text: 'Test text',
      filename: 'test',
      filenum: '0001',
    };

    // Set retry count to 2 (less than 5, so it's an intermediate failure)
    // @ts-expect-error - accessing private property for testing
    pool.retryCount.set(task.partIndex, 2);

    pool.addTask(task);

    // Wait for task to be processed and fail
    await vi.advanceTimersByTimeAsync(100);

    // Verify ladder.recordTask was called with false and attempt number
    expect(recordTaskSpy).toHaveBeenCalledWith(false, 3); // attempt = currentCount (2) + 1 = 3

    // Verify ladder.evaluate was called
    expect(evaluateSpy).toHaveBeenCalled();

    // Verify queue concurrency was updated
    const queue = (pool as unknown as Record<string, unknown>).queue as {
      concurrency: number;
    };
    expect(queue.concurrency).toBe(ladder.getCurrentWorkers());
  });
});
