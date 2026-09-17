import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { CancellationError } from '@/errors';
import type { TTSConfig as VoiceConfig } from '@/state/types';
import type { ChunkStore } from './ChunkStore';
import {
  type PoolOutcome,
  type PoolTask,
  TTSWorkerPool,
  type WorkerPoolOptions,
} from './TTSWorkerPool';

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
  let mockSend: Mock;
  let mockConnect: Mock;
  let mockDisconnect: Mock;
  let mockIsReady: Mock;
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
    return TTSWorkerPool.create({ ...defaultOptions, ...options });
  };

  const createTask = (partIndex: number): PoolTask => ({
    partIndex,
    text: `Text for part ${partIndex}`,
  });

  /** Run a batch under fake timers until the pool settles, then return the outcome. */
  const runToCompletion = async (
    p: TTSWorkerPool,
    tasks: PoolTask[],
    ms: number,
  ): Promise<PoolOutcome> => {
    const pending = p.run(tasks, { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(ms);
    return pending;
  };

  const restubService = () => {
    MockedReusableEdgeTTSService.mockImplementation(function () {
      return {
        connect: mockConnect,
        send: mockSend,
        disconnect: mockDisconnect,
        isReady: mockIsReady,
        getState: vi.fn().mockReturnValue('READY'),
      };
    });
  };

  describe('run - happy path', () => {
    it('writes chunks through the chunk store and resolves the completed set', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      const outcome = await runToCompletion(pool, [createTask(0), createTask(1)], 200);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockChunkStore.writeChunk).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({ completed: new Set([0, 1]), failed: [] });
      expect(onTaskComplete).toHaveBeenCalledTimes(2);
      expect(onTaskComplete).toHaveBeenCalledWith(0);
      expect(onTaskComplete).toHaveBeenCalledWith(1);
    });

    it('processes tasks sequentially when maxWorkers is 1', async () => {
      pool = createPool({ maxWorkers: 1 });

      const outcome = await runToCompletion(pool, [createTask(0), createTask(1)], 200);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(outcome.completed).toEqual(new Set([0, 1]));
    });

    it('uses task-specific voice when provided', async () => {
      pool = createPool();

      const taskWithVoice: PoolTask = { ...createTask(0), voice: 'ru-RU, DmitryNeural' };
      await runToCompletion(pool, [taskWithVoice], 100);

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

      await runToCompletion(pool, [createTask(0)], 100);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            voice: defaultVoiceConfig.voice,
          }),
        }),
      );
    });

    it('connects the worker if not ready before sending', async () => {
      mockIsReady = vi.fn().mockReturnValue(false);
      restubService();

      pool = createPool();
      await runToCompletion(pool, [createTask(0)], 100);

      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('run - retries and backoff', () => {
    it('retries a failed task after backoff and resolves it as completed', async () => {
      let callCount = 0;
      mockSend = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Network error');
        return new Uint8Array([1, 2, 3]);
      });
      restubService();

      const onRetry = vi.fn();
      const onTaskComplete = vi.fn();
      const onTaskError = vi.fn();
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onRetry, onTaskComplete, onTaskError, onConcurrencyChange });

      const outcome = await runToCompletion(pool, [createTask(0)], 10000);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(0, 1, expect.any(Number));
      expect(onTaskComplete).toHaveBeenCalledTimes(1);
      expect(onTaskComplete).toHaveBeenCalledWith(0);
      expect(onTaskError).not.toHaveBeenCalled();
      // The failure path throttles via the ladder before retrying
      expect(onConcurrencyChange).toHaveBeenCalled();
      expect(outcome).toEqual({ completed: new Set([0]), failed: [] });
    });

    it('backs off with capped delays reported through onRetry', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      mockSend = vi.fn().mockRejectedValue(new Error('down'));
      restubService();

      const onRetry = vi.fn();
      pool = createPool({ onRetry });

      await runToCompletion(pool, [createTask(0)], 900000);

      randomSpy.mockRestore();

      // 5 retries with half-max jitter on 3s/10s/30s/60s/120s; attempts beyond 5 stay capped
      expect(onRetry.mock.calls.map((c) => c[2])).toEqual([2250, 7500, 22500, 45000, 90000]);
    });

    it('resolves the failed entry with its message after retries exhaust', async () => {
      mockSend = vi.fn().mockRejectedValue(new Error('Persistent network error'));
      restubService();

      const onTaskError = vi.fn();
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskError, onTaskComplete });

      const outcome = await runToCompletion(pool, [createTask(0)], 900000);

      expect(onTaskError).toHaveBeenCalledTimes(1);
      expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
      expect(onTaskComplete).not.toHaveBeenCalled();
      expect(outcome.completed).toEqual(new Set());
      expect(outcome.failed).toEqual([{ index: 0, message: 'Persistent network error' }]);
    });

    it('processes multiple failed tasks independently', async () => {
      let callCount = 0;
      mockSend = vi.fn(async () => {
        callCount++;
        // First 2 calls fail (tasks 0 and 1)
        if (callCount <= 2) throw new Error('Network error');
        return new Uint8Array([1, 2, 3]);
      });
      restubService();

      pool = createPool();

      // Initial pass: tasks 0 and 1 fail, task 2 succeeds
      const pending = pool.run([createTask(0), createTask(1), createTask(2)], {
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(100);
      mockSend.mockResolvedValue(new Uint8Array([1, 2, 3]));

      // Wait for the retry delays to expire (tasks retry independently)
      await vi.advanceTimersByTimeAsync(10000);
      const outcome = await pending;

      expect(outcome.completed).toEqual(new Set([0, 1, 2]));
      expect(outcome.failed).toEqual([]);
    });
  });

  describe('run - cancellation', () => {
    it('rejects immediately without creating work when the signal is already aborted', async () => {
      pool = createPool();
      const controller = new AbortController();
      controller.abort();

      await expect(pool.run([createTask(0)], { signal: controller.signal })).rejects.toThrow(
        CancellationError,
      );

      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects mid-flight and destroys the in-flight socket without recording progress', async () => {
      mockSend = vi.fn(() => new Promise<Uint8Array>(() => {})); // hangs forever
      restubService();

      const onTaskError = vi.fn();
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskError, onTaskComplete });

      const controller = new AbortController();
      const pending = pool.run([createTask(0)], { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSend).toHaveBeenCalledTimes(1);

      controller.abort();

      await expect(pending).rejects.toThrow(CancellationError);

      // In-flight socket destroyed, no failure or completion recorded
      expect(mockDisconnect).toHaveBeenCalled();
      expect(onTaskError).not.toHaveBeenCalled();
      expect(onTaskComplete).not.toHaveBeenCalled();
    });

    it('rejects mid-flight and drops tasks waiting in retry backoff', async () => {
      let callCount = 0;
      mockSend = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Network error');
        return new Uint8Array([1, 2, 3]);
      });
      restubService();

      pool = createPool();
      const controller = new AbortController();
      const pending = pool.run([createTask(0)], { signal: controller.signal });

      // First attempt fails; task now sits in a backoff timer
      await vi.advanceTimersByTimeAsync(100);
      expect(mockSend).toHaveBeenCalledTimes(1);

      controller.abort();

      await expect(pending).rejects.toThrow(CancellationError);

      // The backoff timer must not wake the task after cancellation
      await vi.advanceTimersByTimeAsync(120000);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('ladder concurrency callback', () => {
    it('reports concurrency changes while tasks run', async () => {
      const onConcurrencyChange = vi.fn();
      pool = createPool({ onConcurrencyChange });

      await runToCompletion(pool, [createTask(0)], 100);

      expect(onConcurrencyChange).toHaveBeenCalled();
    });
  });
});
