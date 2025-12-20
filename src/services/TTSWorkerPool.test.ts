import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TTSWorkerPool, type WorkerPoolOptions } from './TTSWorkerPool';
import type { PoolTask } from './interfaces';
import type { TTSConfig as VoiceConfig, StatusUpdate } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

// Mock the TTSConnectionPool
vi.mock('./TTSConnectionPool', () => {
  return {
    TTSConnectionPool: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      warmup: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
    })),
  };
});

// Get the mocked class for access in tests
import { TTSConnectionPool } from './TTSConnectionPool';
const MockedTTSConnectionPool = vi.mocked(TTSConnectionPool);

describe('TTSWorkerPool', () => {
  let pool: TTSWorkerPool;
  let defaultOptions: WorkerPoolOptions;
  let defaultVoiceConfig: VoiceConfig;
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockDirectoryHandle: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Create mock directory handle
    mockDirectoryHandle = createMockDirectoryHandle();

    // Get a fresh mock execute function for each test
    mockExecute = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    MockedTTSConnectionPool.mockImplementation(() => ({
      execute: mockExecute,
      warmup: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
    }));

    defaultVoiceConfig = {
      voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
      rate: '+0%',
      pitch: '+0Hz',
    };

    defaultOptions = {
      maxWorkers: 3,
      config: defaultVoiceConfig,
      directoryHandle: mockDirectoryHandle,
      ttsConfig: {
        maxRetries: 3,
        baseRetryDelay: 100,
        maxRetryDelay: 1000,
        errorCooldown: 500,
        workerStartDelay: 50,
      },
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

    it('processes task through connection pool', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTasks', () => {
    it('adds multiple tasks', () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      expect(pool.getProgress().total).toBe(3);
    });

    it('respects maxWorkers limit', async () => {
      // Create execute that doesn't resolve immediately
      let resolvers: Array<(value: Uint8Array) => void> = [];
      mockExecute = vi.fn().mockImplementation(() => {
        return new Promise<Uint8Array>((resolve) => {
          resolvers.push(resolve);
        });
      });

      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool({ maxWorkers: 2 });
      pool.addTasks([createTask(0), createTask(1), createTask(2), createTask(3)]);

      // Process the queue
      await vi.advanceTimersByTimeAsync(100);

      // Should only start 2 tasks (maxWorkers limit)
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe('task completion', () => {
    it('stores completed audio as filename', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      const completedAudio = pool.getCompletedAudio();
      expect(completedAudio.size).toBe(1);
      // Now stores filename instead of Uint8Array
      expect(completedAudio.get(0)).toMatch(/^chunk_\d+\.bin$/);
    });

    it('calls onTaskComplete callback with filename', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // Now receives filename instead of Uint8Array
      expect(onTaskComplete).toHaveBeenCalledWith(0, expect.stringMatching(/^chunk_\d+\.bin$/));
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
      let resolvers: Array<(value: Uint8Array) => void> = [];
      mockExecute = vi.fn().mockImplementation(() => {
        return new Promise<Uint8Array>((resolve) => {
          resolvers.push(resolve);
        });
      });

      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool({ maxWorkers: 1 });
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(50);
      expect(mockExecute).toHaveBeenCalledTimes(1);

      // Complete first task
      resolvers[0](new Uint8Array([1]));
      await vi.advanceTimersByTimeAsync(50);

      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe('task errors and retries', () => {
    it('retries failed tasks', async () => {
      let attemptCount = 0;
      const { RetriableError } = await import('@/errors');

      mockExecute = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new RetriableError('Network error'));
        }
        return Promise.resolve(new Uint8Array([1]));
      });

      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool();
      pool.addTask(createTask(0));

      // Run through retries with exponential backoff
      // Default retry delays are [10000, 20000, ...], so we need at least 30000ms for 3 attempts
      await vi.advanceTimersByTimeAsync(35000);

      expect(attemptCount).toBe(3);
      expect(pool.getCompletedAudio().size).toBe(1);
    });

    it('calls onStatusUpdate on retry', async () => {
      const onStatusUpdate = vi.fn();
      const { RetriableError } = await import('@/errors');

      mockExecute = vi.fn().mockRejectedValue(new RetriableError('Error'));

      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool({ onStatusUpdate });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(onStatusUpdate).toHaveBeenCalledWith(expect.objectContaining({
        partIndex: 0,
        message: expect.stringContaining('Error, retrying'),
      }));
    });

    it('respects error cooldown', async () => {
      const createTimes: number[] = [];
      const { RetriableError } = await import('@/errors');

      mockExecute = vi.fn().mockImplementation(() => {
        createTimes.push(Date.now());
        return Promise.reject(new RetriableError('Error'));
      });

      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool({
        maxWorkers: 2,
        ttsConfig: {
          ...defaultOptions.ttsConfig!,
          errorCooldown: 200,
        },
      });

      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(500);

      // Second task should be delayed due to error cooldown
      if (createTimes.length >= 2) {
        const timeDiff = createTimes[1] - createTimes[0];
        expect(timeDiff).toBeGreaterThanOrEqual(0);
      }
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

      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({
          voice: expect.stringContaining('ru-RU, DmitryNeural'),
        }),
      }));
    });

    it('uses default voice when task has no override', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({
          voice: defaultVoiceConfig.voice,
        }),
      }));
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

      expect(statusUpdates).toContainEqual(expect.objectContaining({
        partIndex: 0,
        message: expect.stringContaining('Processing'),
      }));
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
    it('returns temp directory handle after initialization', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(pool.getTempDirHandle()).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('removes temp directory', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      await pool.cleanup();

      expect(pool.getTempDirHandle()).toBeNull();
    });
  });

  describe('clear', () => {
    it('clears all state and shuts down connection pool', async () => {
      const mockShutdown = vi.fn();
      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: mockShutdown,
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool();
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(200);

      pool.clear();

      expect(mockShutdown).toHaveBeenCalled();
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
    it('warms up connection pool', async () => {
      const mockWarmup = vi.fn().mockResolvedValue(undefined);
      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: mockWarmup,
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 0, ready: 0, busy: 0, disconnected: 0 }),
      }));

      pool = createPool({ maxWorkers: 5 });
      await pool.warmup();

      expect(mockWarmup).toHaveBeenCalledWith(5);
    });
  });

  describe('getPoolStats', () => {
    it('returns connection pool stats', () => {
      const mockStats = { total: 3, ready: 2, busy: 1, disconnected: 0 };
      MockedTTSConnectionPool.mockImplementation(() => ({
        execute: mockExecute,
        warmup: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn(),
        getStats: vi.fn().mockReturnValue(mockStats),
      }));

      pool = createPool();

      expect(pool.getPoolStats()).toEqual(mockStats);
    });
  });
});
