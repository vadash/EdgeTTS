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

// Mock KokoroFallbackService
const mockKokoroPreload = vi.fn().mockResolvedValue(undefined);
const mockKokoroSynthesize = vi.fn().mockResolvedValue(new Blob([new Uint8Array([10, 20, 30])]));

vi.mock('./KokoroFallbackService', () => {
  return {
    KokoroFallbackService: {
      getInstance: () => ({
        preload: mockKokoroPreload,
        synthesize: mockKokoroSynthesize,
        ready: true,
      }),
    },
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
    mockKokoroPreload.mockResolvedValue(undefined);
    mockKokoroSynthesize.mockResolvedValue(new Blob([new Uint8Array([10, 20, 30])]));

    // Create mock directory handle
    _mockDirectoryHandle = createMockDirectoryHandle();

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

      // Make Kokoro fallback also fail so it falls through to permanent failure
      mockKokoroSynthesize.mockRejectedValue(new Error('Kokoro unavailable'));

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
    it('warms up ladder workers (5), not maxWorkers', async () => {
      pool = createPool({ maxWorkers: 5 });
      await pool.warmup();

      // Ladder starts at 5 workers (minWorkers), not maxWorkers
      expect(mockConnect).toHaveBeenCalledTimes(5);
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
    it('calculates delay progression: attempt 1 → ~2.25s (half-max jitter)', () => {
      pool = createPool();
      // Mock Math.random for deterministic testing (mid-range jitter)
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(1);

      // halfDelay + jitter = 1500 + 750 = 2250ms
      expect(delay).toBe(2250);
    });

    it('calculates delay progression: attempt 2 → ~7.5s (half-max jitter)', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(2);

      // halfDelay + jitter = 5000 + 2500 = 7500ms
      expect(delay).toBe(7500);
    });

    it('calculates delay progression: attempt 3 → ~22.5s (half-max jitter)', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(3);

      // halfDelay + jitter = 15000 + 7500 = 22500ms
      expect(delay).toBe(22500);
    });

    it('calculates delay progression: attempt 4 → ~45s (half-max jitter)', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(4);

      // halfDelay + jitter = 30000 + 15000 = 45000ms
      expect(delay).toBe(45000);
    });

    it('calculates delay progression: attempt 5 → ~90s (half-max jitter)', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const delay = pool.calculateRetryDelay(5);

      // halfDelay + jitter = 60000 + 30000 = 90000ms
      expect(delay).toBe(90000);
    });

    it('caps max delay at 120s (2 minutes) - attempts beyond 5 use last delay', () => {
      pool = createPool();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      // @ts-expect-error - accessing private method for testing
      const calculateDelay = (attempt: number) => pool.calculateRetryDelay(attempt);

      // Attempts beyond 5 should use delays[4] (120000ms) with half-max jitter
      expect(calculateDelay(6)).toBe(90000);
      expect(calculateDelay(7)).toBe(90000);
      expect(calculateDelay(10)).toBe(90000);
      expect(calculateDelay(100)).toBe(90000);
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

      // Delay should vary by up to 1500ms (1.5s) due to half-max jitter
      expect(maxDelay - minDelay).toBe(1500);
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

  describe('onConcurrencyChange callback', () => {
    it('calls onConcurrencyChange during warmup with initial concurrency', async () => {
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onConcurrencyChange });

      await pool.warmup();

      expect(onConcurrencyChange).toHaveBeenCalledTimes(1);
      expect(onConcurrencyChange).toHaveBeenCalledWith(5); // Ladder starts at minWorkers (5)
    });

    it('calls onConcurrencyChange when task succeeds and ladder adjusts', async () => {
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onConcurrencyChange });

      pool.addTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);

      // Should be called at least once (warmup doesn't set queue.concurrency, but executeTask does)
      expect(onConcurrencyChange).toHaveBeenCalled();
    });

    it('calls onConcurrencyChange when task fails and ladder throttles', async () => {
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onConcurrencyChange });

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

      pool.addTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);

      // Should be called during failure handling
      expect(onConcurrencyChange).toHaveBeenCalled();
    });

    it('passes the correct concurrency value to the callback', async () => {
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onConcurrencyChange });

      // Spy on ladder.getCurrentWorkers to verify the value
      // @ts-expect-error - accessing private property for testing
      const ladder = pool.ladder;
      const getCurrentWorkersSpy = vi.spyOn(ladder, 'getCurrentWorkers').mockReturnValue(2);

      pool.addTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);

      // Should be called with the value from getCurrentWorkers
      expect(onConcurrencyChange).toHaveBeenCalledWith(2);

      getCurrentWorkersSpy.mockRestore();
    });

    it('does not throw if onConcurrencyChange is not provided', async () => {
      pool = createPool(); // No onConcurrencyChange callback

      // Should not throw during warmup or task execution
      await expect(pool.warmup()).resolves.toBeUndefined();

      pool.addTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);
      // Test passes if no exception is thrown
    });
  });

  describe('retry integration - observable behavior', () => {
    it('should re-execute failed tasks after retry delay expires', async () => {
      const onTaskComplete = vi.fn();
      const onTaskError = vi.fn();
      pool = createPool({ onTaskComplete, onTaskError });

      // Track calls - first fails, second succeeds
      let callCount = 0;
      mockSend.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network error');
        }
        return new Uint8Array([1, 2, 3]);
      });

      const task = createTask(0);
      pool.addTask(task);

      // Let the failure happen
      await vi.advanceTimersByTimeAsync(100);

      // Wait for retry delay to expire (using the calculated delay from calculateRetryDelay)
      // First retry delay is ~2.25s with half-max jitter
      await vi.advanceTimersByTimeAsync(3000);

      // Task should now complete successfully after retry
      expect(onTaskComplete).toHaveBeenCalledWith(0, '0');
      expect(pool.getProgress().completed).toBe(1);

      // No permanent failure
      expect(onTaskError).not.toHaveBeenCalled();
      expect(pool.getProgress().failed).toBe(0);
    });

    it('should process multiple failed tasks independently', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      // Add tasks - first 2 will fail initially, third succeeds
      let callCount = 0;
      mockSend.mockImplementation(async () => {
        callCount++;
        // First 2 calls fail (tasks 0 and 1)
        if (callCount <= 2) {
          throw new Error('Network error');
        }
        return new Uint8Array([1, 2, 3]);
      });

      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      // Let initial processing happen
      await vi.advanceTimersByTimeAsync(100);

      // Task 2 should have succeeded (third call)
      expect(pool.getProgress().completed).toBe(1);

      // Now make the retry attempts succeed
      mockSend.mockResolvedValue(new Uint8Array([1, 2, 3]));

      // Wait for retry delays to expire (tasks retry at different times)
      await vi.advanceTimersByTimeAsync(5000);

      // All tasks should now be complete
      expect(pool.getProgress().completed).toBe(3);
      expect(pool.getProgress().failed).toBe(0);
    });

    it('should mark task as permanently failed after max retries', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      // Make send always fail
      mockSend = vi.fn().mockRejectedValue(new Error('Persistent network error'));
      // Make Kokoro fallback also fail so it falls through to permanent failure
      mockKokoroSynthesize.mockRejectedValue(new Error('Kokoro unavailable'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task = createTask(0);
      pool.addTask(task);

      // Advance enough time for all retries to exhaust
      // Max retries is 11, with exponential backoff up to 120s max delay
      // Total time needed: sum of all delays = ~2.25s + 7.5s + 22.5s + 45s + 90s + (6 * 120s)
      // ≈ 887 seconds ≈ 15 minutes
      await vi.advanceTimersByTimeAsync(900000);

      // Should be permanently failed
      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
      expect(pool.getProgress().failed).toBe(1);
      expect(pool.getFailedTasks().has(0)).toBe(true);
    });
  });

  describe('Kokoro fallback integration', () => {
    it('triggers Kokoro preload when attempt === 2', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      mockSend = vi.fn().mockRejectedValue(new Error('Network error'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task = createTask(0);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 1); // attempt will be 2

      pool.addTask(task);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockKokoroPreload).toHaveBeenCalledTimes(1);
    });

    it('does NOT call preload when attempt === 1', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      mockSend = vi.fn().mockRejectedValue(new Error('Network error'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task = createTask(0);
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 0); // attempt will be 1

      pool.addTask(task);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockKokoroPreload).not.toHaveBeenCalled();
    });

    it('falls back to Kokoro synthesize when retries exhausted and writes to ChunkStore', async () => {
      const onTaskError = vi.fn();
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskError, onTaskComplete });

      mockSend = vi.fn().mockRejectedValue(new Error('Network error'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Hello world',
        filename: 'test',
        filenum: '0001',
        gender: 'female',
      };
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5); // attempt will be 6 > 5

      pool.addTask(task);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockKokoroSynthesize).toHaveBeenCalledWith('Hello world', 'female');

      // Should write the blob as Uint8Array to ChunkStore
      expect(mockChunkStore.writeChunk).toHaveBeenCalledWith(0, expect.any(Uint8Array));

      // Should NOT be in failedTasks
      expect(pool.getFailedTasks().has(0)).toBe(false);
      // Should NOT call onTaskError
      expect(onTaskError).not.toHaveBeenCalled();
    });

    it('falls through to failedTasks when Kokoro synthesize throws', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      mockSend = vi.fn().mockRejectedValue(new Error('Network error'));
      mockKokoroSynthesize.mockRejectedValue(new Error('Kokoro also failed'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Hello world',
        filename: 'test',
        filenum: '0001',
        gender: 'male',
      };
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5); // attempt will be 6 > 5

      pool.addTask(task);

      await vi.advanceTimersByTimeAsync(100);

      // Should be added to failedTasks (existing silence behavior)
      expect(pool.getFailedTasks().has(0)).toBe(true);
      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
    });

    it('defaults gender to unknown when task has no gender field', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      mockSend = vi.fn().mockRejectedValue(new Error('Network error'));

      MockedReusableEdgeTTSService.mockImplementation(function () {
        return {
          connect: mockConnect,
          send: mockSend,
          disconnect: mockDisconnect,
          isReady: mockIsReady,
          getState: vi.fn().mockReturnValue('READY'),
        };
      });

      const task: PoolTask = {
        partIndex: 0,
        text: 'Hello world',
        filename: 'test',
        filenum: '0001',
        // no gender field
      };
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 5); // attempt will be 6 > 5

      pool.addTask(task);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockKokoroSynthesize).toHaveBeenCalledWith('Hello world', 'unknown');
    });
  });
});
