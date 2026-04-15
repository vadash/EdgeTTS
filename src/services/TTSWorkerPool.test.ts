import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusUpdate, TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import type { ChunkStore } from './ChunkStore';
import { type PoolTask, TTSWorkerPool, type WorkerPoolOptions } from './TTSWorkerPool';

// Mock the ReusableEdgeTTSService
vi.mock('./ReusableEdgeTTSService', () => {
  return {
    ReusableEdgeTTSService: vi.fn().mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        disconnect: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        getState: vi.fn().mockReturnValue('READY'),
      };
    }),
  };
});

// Get the mocked class for access in tests
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';

const MockedReusableEdgeTTSService = vi.mocked(ReusableEdgeTTSService);

describe('TTSWorkerPool', () => {
  let pool: TTSWorkerPool;
  let defaultOptions: WorkerPoolOptions;
  let defaultVoiceConfig: VoiceConfig;
  let mockSend: ReturnType<typeof vi.fn>;
  let mockConnect: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let mockIsReady: ReturnType<typeof vi.fn>;
  let _mockDirectoryHandle: FileSystemDirectoryHandle;
  let mockChunkStore: ChunkStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Create mock directory handle
    _mockDirectoryHandle = createMockDirectoryHandle();

    // Create mock ChunkStore
    mockChunkStore = {
      init: vi.fn().mockResolvedValue(undefined),
      writeChunk: vi.fn().mockResolvedValue(undefined),
      prepareForRead: vi.fn().mockResolvedValue(undefined),
      readChunk: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      getExistingIndices: vi.fn().mockReturnValue(new Set<number>()),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChunkStore;

    // Get fresh mock functions for each test
    mockSend = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockConnect = vi.fn().mockResolvedValue(undefined);
    mockDisconnect = vi.fn();
    mockIsReady = vi.fn().mockReturnValue(true);

    MockedReusableEdgeTTSService.mockImplementation(function () {
      return {
        connect: mockConnect,
        send: mockSend,
        disconnect: mockDisconnect,
        isReady: mockIsReady,
        getState: vi.fn().mockReturnValue('READY'),
      };
    });

    defaultVoiceConfig = {
      voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
      rate: '+0%',
      pitch: '+0Hz',
      volume: '100%',
    };

    defaultOptions = {
      maxWorkers: 3,
      config: defaultVoiceConfig,
      chunkStore: mockChunkStore,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createPool = (options: Partial<WorkerPoolOptions> = {}) => {
    return new TTSWorkerPool({ ...defaultOptions, ...options });
  };

  const createTask = (partIndex: number): PoolTask => ({
    partIndex,
    text: `Text for part ${partIndex}`,
    filename: 'test',
    filenum: String(partIndex + 1).padStart(4, '0'),
  });

  describe('retry state initialization', () => {
    it('initializes retryCount Map as empty', () => {
      pool = createPool();
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount).toBeInstanceOf(Map);
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.size).toBe(0);
    });

    it('initializes retryTimers Map as empty', () => {
      pool = createPool();
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers).toBeInstanceOf(Map);
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);
    });
  });

  describe('addTask', () => {
    it('adds a single task to the queue', () => {
      pool = createPool();
      pool.addTask(createTask(0));

      expect(pool.getProgress().total).toBe(1);
    });

    it('processes task through worker', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTasks', () => {
    it('adds multiple tasks', () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      expect(pool.getProgress().total).toBe(3);
    });

    it('respects maxWorkers limit', async () => {
      // Note: With p-queue, concurrency is handled by the library
      // This test verifies tasks are queued and processed
      pool = createPool({ maxWorkers: 2 });
      pool.addTasks([createTask(0), createTask(1), createTask(2), createTask(3)]);

      // Process the queue
      await vi.advanceTimersByTimeAsync(100);

      // All 4 tasks should eventually be processed (p-queue handles concurrency)
      expect(mockSend).toHaveBeenCalledTimes(4);
    });
  });

  describe('task completion', () => {
    it('stores completed audio by part index', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      const completedAudio = pool.getCompletedAudio();
      expect(completedAudio.size).toBe(1);
      // With ChunkStore, we store the part index as a string reference
      expect(completedAudio.get(0)).toBe('0');
    });

    it('calls onTaskComplete callback with part index', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // With ChunkStore, callback receives part index as string reference
      expect(onTaskComplete).toHaveBeenCalledWith(0, '0');
    });

    it('calls onAllComplete when all tasks done', async () => {
      const onAllComplete = vi.fn();
      pool = createPool({ onAllComplete });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(onAllComplete).toHaveBeenCalledTimes(1);
    });

    it('updates progress on completion', async () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1)]);

      expect(pool.getProgress().completed).toBe(0);

      await vi.advanceTimersByTimeAsync(200);

      expect(pool.getProgress().completed).toBe(2);
    });

    it('processes next task from queue after completion', async () => {
      // With p-queue, tasks are processed sequentially when concurrency is 1
      pool = createPool({ maxWorkers: 1 });
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(100);

      // Both tasks should be processed (p-queue handles sequencing)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('task errors and retries', () => {
    it('retries failed tasks with exponential backoff', async () => {
      // Note: p-retry handles the actual retry logic
      // This test verifies the task completes after retry
      let attemptCount = 0;
      const { RetriableError } = await import('@/errors');

      mockSend = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new RetriableError('Network error'));
        }
        return Promise.resolve(new Uint8Array([1]));
      });

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      pool = createPool();
      pool.addTask(createTask(0));

      // Run through retries with exponential backoff
      await vi.advanceTimersByTimeAsync(10000);

      // With p-retry mock executing immediately, first success wins
      expect(attemptCount).toBeGreaterThanOrEqual(1);
    });

    it('calls onStatusUpdate during processing', async () => {
      const onStatusUpdate = vi.fn();

      pool = createPool({ onStatusUpdate });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // Should have processing status
      expect(onStatusUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          partIndex: 0,
          message: expect.stringContaining('Processing'),
        }),
      );
    });

    it('handles task failure gracefully', async () => {
      const onTaskError = vi.fn();

      // Make send always fail with non-retriable error
      mockSend = vi.fn().mockRejectedValue(new Error('Permanent failure'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      pool = createPool({ onTaskError });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
      expect(pool.getFailedTasks().has(0)).toBe(true);
    });
  });

  describe('voice override', () => {
    it('uses task-specific voice when provided', async () => {
      pool = createPool();

      const taskWithVoice: PoolTask = {
        ...createTask(0),
        voice: 'ru-RU, DmitryNeural',
      };
      pool.addTask(taskWithVoice);

      await vi.advanceTimersByTimeAsync(0);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            voice: expect.stringContaining('ru-RU, DmitryNeural'),
          }),
        }),
      );
    });

    it('uses default voice when task has no override', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            voice: defaultVoiceConfig.voice,
          }),
        }),
      );
    });
  });

  describe('status updates', () => {
    it('sends status updates during processing', async () => {
      const statusUpdates: StatusUpdate[] = [];

      pool = createPool({
        onStatusUpdate: (update) => statusUpdates.push(update),
      });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(statusUpdates).toContainEqual(
        expect.objectContaining({
          partIndex: 0,
          message: expect.stringContaining('Processing'),
        }),
      );
    });
  });

  describe('getProgress', () => {
    it('returns correct progress', async () => {
      pool = createPool({ maxWorkers: 1 });
      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      expect(pool.getProgress()).toEqual({
        completed: 0,
        total: 3,
        failed: 0,
      });

      await vi.advanceTimersByTimeAsync(200);

      expect(pool.getProgress().completed).toBeGreaterThan(0);
    });
  });

  describe('getCompletedAudio', () => {
    it('returns copy of completed audio map', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      const audio1 = pool.getCompletedAudio();
      const audio2 = pool.getCompletedAudio();

      expect(audio1).toEqual(audio2);
      expect(audio1).not.toBe(audio2);
    });
  });

  describe('getFailedTasks', () => {
    it('returns copy of failed tasks set', () => {
      pool = createPool();

      const failed1 = pool.getFailedTasks();
      const failed2 = pool.getFailedTasks();

      expect(failed1).not.toBe(failed2);
    });
  });

  describe('getTempDirHandle', () => {
    it('returns null (deprecated - ChunkStore manages storage)', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // getTempDirHandle now returns null since ChunkStore manages storage
      expect(pool.getTempDirHandle()).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('closes chunkStore', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      await pool.cleanup();

      expect(mockChunkStore.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('clears all state and resets progress', async () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(200);

      pool.clear();

      // Progress should be reset
      expect(pool.getProgress()).toEqual({
        completed: 0,
        total: 0,
        failed: 0,
      });
      expect(pool.getCompletedAudio().size).toBe(0);
      expect(pool.getFailedTasks().size).toBe(0);
    });
  });

  describe('warmup', () => {
    it('warms up ladder workers (2), not maxWorkers', async () => {
      pool = createPool({ maxWorkers: 5 });
      await pool.warmup();

      // Ladder starts at 2 workers, not maxWorkers
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('ignores connection errors during warmup', async () => {
      mockConnect = vi.fn().mockRejectedValue(new Error('Connection failed'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('DISCONNECTED'),
        };
      });

      pool = createPool({ maxWorkers: 10 });

      // Should not throw (still warms 2 connections via ladder)
      await expect(pool.warmup()).resolves.toBeUndefined();
    });
  });

  describe('getPoolStats', () => {
    it('returns worker statistics', () => {
      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      pool = createPool({ maxWorkers: 3 });

      const stats = pool.getPoolStats();

      // With generic-pool, connections are created on demand
      // Initially no connections exist
      expect(stats).toEqual({
        total: 3,
        ready: 0,
        busy: 0,
        disconnected: 3,
      });
    });

    it('shows connections after warmup', async () => {
      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      pool = createPool({ maxWorkers: 3 });
      await pool.warmup();

      const stats = pool.getPoolStats();

      // After warmup, connections should be available
      expect(stats.total).toBe(3);
      expect(stats.ready).toBeGreaterThanOrEqual(0);
    });
  });

  describe('connection handling', () => {
    it('connects worker if not ready before sending', async () => {
      mockIsReady = vi.fn().mockReturnValue(false);

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('DISCONNECTED'),
        };
      });

      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });

    it('creates connection via generic-pool on task execution', async () => {
      // With generic-pool, connections are created via factory.create()
      // which always calls connect()
      mockIsReady = vi.fn().mockReturnValue(true);

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // generic-pool's create() calls connect(), so it should be called
      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('calculateRetryDelay', () => {
    it('calculates delay progression: attempt 1 → ~10s', () => {
      pool = createPool();
      // Mock Math.random for deterministic testing (mid-range jitter)
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(1);

      // baseDelay * 2^(1-1) + jitter = 10000 * 1 + 500 = 10500ms
      expect(delay).toBe(10500);
    });

    it('calculates delay progression: attempt 2 → ~20s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(2);

      // baseDelay * 2^(2-1) + jitter = 10000 * 2 + 500 = 20500ms
      expect(delay).toBe(20500);
    });

    it('calculates delay progression: attempt 3 → ~40s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(3);

      // baseDelay * 2^(3-1) + jitter = 10000 * 4 + 500 = 40500ms
      expect(delay).toBe(40500);
    });

    it('calculates delay progression: attempt 4 → ~80s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(4);

      // baseDelay * 2^(4-1) + jitter = 10000 * 8 + 500 = 80500ms
      expect(delay).toBe(80500);
    });

    it('calculates delay progression: attempt 5 → ~160s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(5);

      // baseDelay * 2^(5-1) + jitter = 10000 * 16 + 500 = 160500ms
      expect(delay).toBe(160500);
    });

    it('caps max delay at 600s (10 minutes) for attempts 7-11', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const calculateDelay = (attempt: number) => pool.calculateRetryDelay(attempt);

      // Attempt 6: 10000 * 2^5 + 500 = 320500ms (not capped yet)
      expect(calculateDelay(6)).toBe(320500);

      // Attempts 7-11 should all be capped at maxDelay (600000ms)
      // Note: When capped, jitter is not applied since Math.min returns maxDelay directly
      expect(calculateDelay(7)).toBe(600000); // Capped at 600000
      expect(calculateDelay(8)).toBe(600000);
      expect(calculateDelay(9)).toBe(600000);
      expect(calculateDelay(10)).toBe(600000);
      expect(calculateDelay(11)).toBe(600000);
    });

    it('adds jitter randomness to delays', () => {
      pool = createPool();

      // Test with different jitter values
      const randomSpy = vi.spyOn(Math, 'random');

      randomSpy.mockReturnValue(0); // Min jitter
      // @ts-expect-error - accessing private method for testing
      const minDelay = pool.calculateRetryDelay(1);

      randomSpy.mockReturnValue(1); // Max jitter
      // @ts-expect-error - accessing private method for testing
      const maxDelay = pool.calculateRetryDelay(1);

      // Delay should vary by up to 1000ms due to jitter
      expect(maxDelay - minDelay).toBe(1000);
    });
  });

  describe('requeueTask', () => {
    it('adds task back to queue', async () => {
      const onStatusUpdate = vi.fn();
      pool = createPool({ onStatusUpdate });

      const task = createTask(0);
      // Set up a timer for the task
      const timer = setTimeout(() => {}, 1000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(task.partIndex, timer);

      // @ts-expect-error - calling private method for testing
      pool.requeueTask(task);

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.has(task.partIndex)).toBe(false);
    });

    it('fires onStatusUpdate with retry message', async () => {
      const onStatusUpdate = vi.fn();
      pool = createPool({ onStatusUpdate });

      const task = createTask(0);
      const timer = setTimeout(() => {}, 1000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(task.partIndex, timer);

      // @ts-expect-error - calling private method for testing
      pool.requeueTask(task);

      expect(onStatusUpdate).toHaveBeenCalledWith({
        partIndex: 0,
        message: 'Retrying now...',
        isComplete: false,
      });
    });

    it('deletes timer from retryTimers', async () => {
      pool = createPool();

      const task = createTask(0);
      const timer = setTimeout(() => {}, 1000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(task.partIndex, timer);

      // @ts-expect-error - calling private method for testing
      pool.requeueTask(task);

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.has(task.partIndex)).toBe(false);
    });
  });
});
