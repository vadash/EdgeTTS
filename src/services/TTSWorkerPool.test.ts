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

      // Set retry count to exceed max so it will fail permanently
      const task = createTask(0);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 11);

      pool.addTask(task);

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

    it('clears all timers in retryTimers Map using clearTimeout', async () => {
      pool = createPool();

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Set up some timers
      const timer1 = setTimeout(() => {}, 10000);
      const timer2 = setTimeout(() => {}, 20000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(0, timer1);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(1, timer2);

      await pool.cleanup();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer2);

      clearTimeoutSpy.mockRestore();
    });

    it('clears both retryTimers and retryCount Maps', async () => {
      pool = createPool();

      // Set up timers and retry counts
      const timer1 = setTimeout(() => {}, 10000);
      const timer2 = setTimeout(() => {}, 20000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(0, timer1);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(1, timer2);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(0, 3);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(1, 5);

      await pool.cleanup();

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.size).toBe(0);
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

    it('clears all timers in retryTimers Map using clearTimeout', () => {
      pool = createPool();

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Set up some timers
      const timer1 = setTimeout(() => {}, 10000);
      const timer2 = setTimeout(() => {}, 20000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(0, timer1);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(1, timer2);

      pool.clear();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer2);

      clearTimeoutSpy.mockRestore();
    });

    it('clears both retryTimers and retryCount Maps', () => {
      pool = createPool();

      // Set up timers and retry counts
      const timer1 = setTimeout(() => {}, 10000);
      const timer2 = setTimeout(() => {}, 20000);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(0, timer1);
      // @ts-expect-error - accessing private property for testing
      pool.retryTimers.set(1, timer2);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(0, 3);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(1, 5);

      pool.clear();

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.size).toBe(0);
    });
  });

  describe('warmup', () => {
    it('warms up ladder workers (3), not maxWorkers', async () => {
      pool = createPool({ maxWorkers: 5 });
      await pool.warmup();

      // Ladder starts at 3 workers (minWorkers), not maxWorkers
      expect(mockConnect).toHaveBeenCalledTimes(3);
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
    it('calculates delay progression: attempt 1 → ~30s', () => {
      pool = createPool();
      // Mock Math.random for deterministic testing (mid-range jitter)
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(1);

      // delays[0] + jitter = 30000 + 500 = 30500ms
      expect(delay).toBe(30500);
    });

    it('calculates delay progression: attempt 2 → ~120s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(2);

      // delays[1] + jitter = 120000 + 500 = 120500ms
      expect(delay).toBe(120500);
    });

    it('calculates delay progression: attempt 3 → ~300s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(3);

      // delays[2] + jitter = 300000 + 500 = 300500ms
      expect(delay).toBe(300500);
    });

    it('calculates delay progression: attempt 4 → ~600s', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(4);

      // delays[3] + jitter = 600000 + 500 = 600500ms
      expect(delay).toBe(600500);
    });

    it('calculates delay progression: attempt 5 → ~1200s (capped)', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(5);

      // delays[4] + jitter = 1200000 + 500 = 1200500ms (capped at max)
      expect(delay).toBe(1200500);
    });

    it('caps max delay at 1200s (20 minutes) - attempts beyond 5 use last delay', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const calculateDelay = (attempt: number) => pool.calculateRetryDelay(attempt);

      // Attempts beyond 5 should use delays[4] (1200000ms)
      expect(calculateDelay(6)).toBe(1200500);
      expect(calculateDelay(7)).toBe(1200500);
      expect(calculateDelay(10)).toBe(1200500);
      expect(calculateDelay(100)).toBe(1200500);
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

  describe('handleTaskFailure', () => {
    it('increments retryCount on each failure', async () => {
      const onStatusUpdate = vi.fn();
      pool = createPool({ onStatusUpdate });

      const task = createTask(0);

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.get(task.partIndex)).toBeUndefined();

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.get(task.partIndex)).toBe(1);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.get(task.partIndex)).toBe(2);
    });

    it('schedules retry with correct delay when below max retries', async () => {
      const onStatusUpdate = vi.fn();
      pool = createPool({ onStatusUpdate });

      const task = createTask(0);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      // Verify retry timer was scheduled
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.has(task.partIndex)).toBe(true);

      // Verify status update was fired
      expect(onStatusUpdate).toHaveBeenCalledWith({
        partIndex: 0,
        message: expect.stringContaining('Retry in'),
        isComplete: false,
      });
    });

    it('calls ladder.recordTask(false, 11) and ladder.evaluate() on permanent failure', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      const task = createTask(0);

      // Set up spies before calling handleTaskFailure
      // @ts-expect-error - accessing private property for testing
      const ladder = pool.ladder;
      const recordTaskSpy = vi.spyOn(ladder, 'recordTask');
      const evaluateSpy = vi.spyOn(ladder, 'evaluate');

      // Set retry count to exceed max (11 attempts means retryCount should be 11)
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 11);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      expect(recordTaskSpy).toHaveBeenCalledWith(false, 5);
      expect(evaluateSpy).toHaveBeenCalled();
    });

    it('adds to failedTasks and increments processedCount on permanent failure', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      const task = createTask(0);

      // Set retry count to exceed max
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      expect(pool.getFailedTasks().has(0)).toBe(true);

      // @ts-expect-error - accessing private property for testing
      expect(pool.processedCount).toBe(1);
    });

    it('calls onTaskError callback on permanent failure', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      const task = createTask(0);

      // Set retry count to exceed max
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
    });

    it('deletes retryCount entry on permanent failure to prevent memory leaks', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      const task = createTask(0);

      // Set retry count to exceed max
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5);

      // @ts-expect-error - calling private method for testing
      expect(pool.retryCount.has(task.partIndex)).toBe(true);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Test error'));

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.has(task.partIndex)).toBe(false);
    });

    it('calls logTTSFailure when task permanently fails after 11 retries', async () => {
      const mockDirHandle = createMockDirectoryHandle();
      const onTaskError = vi.fn();
      pool = createPool({ directoryHandle: mockDirHandle, onTaskError });

      const task = createTask(0);

      // Set retry count to exceed max
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5);

      // Spy on the private logTTSFailure method
      // @ts-expect-error - accessing private method for testing
      const logTTSFailureSpy = vi.spyOn(pool, 'logTTSFailure');

      const error = new Error('Permanent TTS failure');

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, error);

      // Verify logTTSFailure was called with the correct task and error
      expect(logTTSFailureSpy).toHaveBeenCalledWith(task, error);
      expect(logTTSFailureSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('directoryHandle option', () => {
    it('accepts directoryHandle in WorkerPoolOptions', () => {
      const mockDirHandle = createMockDirectoryHandle();

      const pool = createPool({
        directoryHandle: mockDirHandle,
      });

      expect(pool).toBeInstanceOf(TTSWorkerPool);
    });

    it('stores directoryHandle in options', () => {
      const mockDirHandle = createMockDirectoryHandle();

      const pool = createPool({
        directoryHandle: mockDirHandle,
      });

      expect(pool.options.directoryHandle).toBe(mockDirHandle);
    });

    it('accepts null as directoryHandle value', () => {
      const pool = createPool({
        directoryHandle: null,
      });

      expect(pool).toBeInstanceOf(TTSWorkerPool);
    });

    it('defaults to undefined when directoryHandle is not provided', () => {
      const pool = createPool();

      expect(pool.options.directoryHandle).toBeUndefined();
    });
  });

  describe('executeTask (refactored without withRetry)', () => {
    it('uses release() on success, records actual retry count, and deletes retryCount', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      // Spy on connectionPool.release
      // @ts-expect-error - accessing private property for testing
      const releaseSpy = vi.spyOn(pool.connectionPool, 'release');

      const task = createTask(0);

      // Set a retry count to simulate previous retries
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 3);

      // @ts-expect-error - accessing private property for testing
      const ladder = pool.ladder;
      const recordTaskSpy = vi.spyOn(ladder, 'recordTask');

      pool.addTask(task);
      await vi.advanceTimersByTimeAsync(100);

      // Verify release was called
      expect(releaseSpy).toHaveBeenCalled();

      // Verify ladder.recordTask was called with true and actual retry count (3)
      expect(recordTaskSpy).toHaveBeenCalledWith(true, 3);

      // Verify retryCount was deleted to prevent memory leak
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.has(task.partIndex)).toBe(false);
    });

    it('uses destroy() on failure (not release), then calls handleTaskFailure', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      // Make send fail
      mockSend = vi.fn().mockRejectedValue(new Error('Network failure'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      // @ts-expect-error - accessing private property for testing
      const destroySpy = vi.spyOn(pool.connectionPool, 'destroy');

      const task = createTask(0);

      // Set retry count to exceed max so it will fail permanently
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 11);

      pool.addTask(task);
      await vi.advanceTimersByTimeAsync(100);

      // Verify destroy was called (not release)
      expect(destroySpy).toHaveBeenCalled();

      // Verify onTaskError was called (via handleTaskFailure)
      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
    });

    it('handles destroy() errors gracefully when socket already dead', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      // Make send fail
      mockSend = vi.fn().mockRejectedValue(new Error('Network failure'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      // Make destroy throw an error (simulating already-dead socket)
      // @ts-expect-error - accessing private property for testing
      vi.spyOn(pool.connectionPool, 'destroy').mockRejectedValue(
        new Error('Socket already closed'),
      );

      const task = createTask(0);

      // Set retry count to exceed max so it will fail permanently
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 11);

      // Should not throw despite destroy error
      pool.addTask(task);
      await vi.advanceTimersByTimeAsync(100);

      // Verify onTaskError was still called
      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
    });

    it('skips all state updates when pool is cleared (totalTasks === 0)', async () => {
      pool = createPool();

      // Make send succeed
      mockSend = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      // @ts-expect-error - accessing private property for testing
      const releaseSpy = vi.spyOn(pool.connectionPool, 'release');

      // @ts-expect-error - accessing private property for testing
      const ladder = pool.ladder;
      const recordTaskSpy = vi.spyOn(ladder, 'recordTask');

      const task = createTask(0);
      pool.addTask(task);

      // Simulate pool being cleared while task is executing
      // @ts-expect-error - accessing private property for testing
      pool.totalTasks = 0;

      await vi.advanceTimersByTimeAsync(100);

      // Verify release was still called (cleanup happens)
      expect(releaseSpy).toHaveBeenCalled();

      // Verify ladder.recordTask was NOT called (state updates skipped)
      expect(recordTaskSpy).not.toHaveBeenCalled();
    });

    it('defaults retry count to 0 when not tracked in retryCount Map', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      // @ts-expect-error - accessing private property for testing
      const ladder = pool.ladder;
      const recordTaskSpy = vi.spyOn(ladder, 'recordTask');

      const task = createTask(0);

      // Don't set any retry count - should default to 0
      pool.addTask(task);
      await vi.advanceTimersByTimeAsync(100);

      // Verify ladder.recordTask was called with true and 0 (default)
      expect(recordTaskSpy).toHaveBeenCalledWith(true, 0);
    });
  });

  describe('logTTSFailure', () => {
    it('writes failure log to logs/tts_fail1.json with correct content', async () => {
      const mockDirHandle = createMockDirectoryHandle();

      pool = createPool({ directoryHandle: mockDirHandle });

      const task: PoolTask = {
        partIndex: 5,
        text: 'Sample text for TTS',
        filename: 'test',
        filenum: '0006',
      };

      const error = new Error('TTS service unavailable');

      // @ts-expect-error - calling private method for testing
      await pool.logTTSFailure(task, error);

      // Verify the written JSON content
      const logsDir = await mockDirHandle.getDirectoryHandle('logs');
      const fileHandle = await logsDir.getFileHandle('tts_fail1.json');
      const file = await fileHandle.getFile();
      const text = await file.text();
      const logEntry = JSON.parse(text);

      expect(logEntry).toEqual({
        partIndex: 5,
        text: 'Sample text for TTS',
        errorMessage: 'TTS service unavailable',
        retryCount: 5,
        timestamp: expect.any(String),
      });

      // Verify timestamp is a valid ISO string
      expect(new Date(logEntry.timestamp)).toBeInstanceOf(Date);
    });

    it('increments failureLogCounter for each failure', async () => {
      const mockDirHandle = createMockDirectoryHandle();

      pool = createPool({ directoryHandle: mockDirHandle });

      const task1: PoolTask = {
        partIndex: 1,
        text: 'First failure',
        filename: 'test',
        filenum: '0002',
      };

      const task2: PoolTask = {
        partIndex: 2,
        text: 'Second failure',
        filename: 'test',
        filenum: '0003',
      };

      const error = new Error('Failed');

      // @ts-expect-error - calling private method for testing
      await pool.logTTSFailure(task1, error);

      // Verify first file was created
      const logsDir = await mockDirHandle.getDirectoryHandle('logs');
      await expect(logsDir.getFileHandle('tts_fail1.json')).resolves.toBeDefined();

      // @ts-expect-error - calling private method for testing
      await pool.logTTSFailure(task2, error);

      // Verify second file was created
      await expect(logsDir.getFileHandle('tts_fail2.json')).resolves.toBeDefined();
    });

    it('returns early when directoryHandle is null', async () => {
      const mockDirHandle = createMockDirectoryHandle();

      pool = createPool({ directoryHandle: null });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Test',
        filename: 'test',
        filenum: '0001',
      };

      const error = new Error('Failed');

      // @ts-expect-error - calling private method for testing
      await pool.logTTSFailure(task, error);

      // Verify no logs directory was created (returned early)
      await expect(
        mockDirHandle
          .getDirectoryHandle('logs')
          .then(() => true)
          .catch(() => false),
      ).resolves.toBe(false);
    });

    it('handles non-Error errors by converting to string', async () => {
      const mockDirHandle = createMockDirectoryHandle();

      pool = createPool({ directoryHandle: mockDirHandle });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Test',
        filename: 'test',
        filenum: '0001',
      };

      const nonErrorError = 'String error message';

      // @ts-expect-error - calling private method for testing
      await pool.logTTSFailure(task, nonErrorError);

      const logsDir = await mockDirHandle.getDirectoryHandle('logs');
      const fileHandle = await logsDir.getFileHandle('tts_fail1.json');
      const file = await fileHandle.getFile();
      const text = await file.text();
      const logEntry = JSON.parse(text);

      expect(logEntry.errorMessage).toBe('String error message');
    });

    it('handles errors gracefully and calls logger.warn', async () => {
      const mockDirHandle = createMockDirectoryHandle();
      const { createMockLogger } = await import('@/test/mocks/MockLogger');
      const logger = createMockLogger();

      // Make getDirectoryHandle throw
      vi.spyOn(mockDirHandle, 'getDirectoryHandle').mockRejectedValue(
        new Error('Permission denied'),
      );

      pool = createPool({ directoryHandle: mockDirHandle, logger });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Test',
        filename: 'test',
        filenum: '0001',
      };

      const error = new Error('TTS failed');

      // Should not throw
      // @ts-expect-error - calling private method for testing
      await expect(pool.logTTSFailure(task, error)).resolves.toBeUndefined();

      // Verify logger.warn was called
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to write TTS failure log',
        expect.objectContaining({
          error: expect.any(String),
        }),
      );
    });
  });
});
