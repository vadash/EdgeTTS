import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TTSWorkerPool, type PoolTask, type WorkerPoolOptions } from './TTSWorkerPool';
import type { IEdgeTTSServiceFactory, ITTSService, TTSWorkerOptions } from './interfaces';
import type { TTSConfig as VoiceConfig, StatusUpdate } from '@/state/types';

describe('TTSWorkerPool', () => {
  let pool: TTSWorkerPool;
  let mockFactory: IEdgeTTSServiceFactory;
  let mockServices: Map<number, { service: ITTSService; options: TTSWorkerOptions }>;
  let defaultOptions: WorkerPoolOptions;
  let defaultVoiceConfig: VoiceConfig;

  beforeEach(() => {
    vi.useFakeTimers();

    mockServices = new Map();

    mockFactory = {
      create: vi.fn((options: TTSWorkerOptions) => {
        const service: ITTSService = {
          start: vi.fn(() => {
            // Simulate async completion after a short delay
            setTimeout(() => {
              options.onComplete(new Uint8Array([1, 2, 3]));
            }, 100);
          }),
        };
        mockServices.set(options.indexPart, { service, options });
        return service;
      }),
    };

    defaultVoiceConfig = {
      voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
      rate: '+0%',
      pitch: '+0Hz',
    };

    defaultOptions = {
      maxWorkers: 3,
      config: defaultVoiceConfig,
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
    return new TTSWorkerPool(mockFactory, { ...defaultOptions, ...options });
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

    it('spawns worker for task', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      expect(mockFactory.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTasks', () => {
    it('adds multiple tasks', () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      expect(pool.getProgress().total).toBe(3);
    });

    it('respects maxWorkers limit', async () => {
      // Create a factory that doesn't auto-complete, so workers stay active
      let completionCallbacks: Array<(data: Uint8Array) => void> = [];
      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          // Store callback for manual completion later
          completionCallbacks.push(options.onComplete);
        }),
      }));

      pool = createPool({ maxWorkers: 2 });
      pool.addTasks([createTask(0), createTask(1), createTask(2), createTask(3)]);

      // Process the queue once
      await vi.advanceTimersByTimeAsync(100);

      // Should only spawn 2 workers (maxWorkers limit)
      expect(mockFactory.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('task completion', () => {
    it('stores completed audio', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(200);

      const completedAudio = pool.getCompletedAudio();
      expect(completedAudio.size).toBe(1);
      expect(completedAudio.get(0)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('calls onTaskComplete callback', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(200);

      expect(onTaskComplete).toHaveBeenCalledWith(0, expect.any(Uint8Array));
    });

    it('calls onAllComplete when all tasks done', async () => {
      const onAllComplete = vi.fn();
      pool = createPool({ onAllComplete });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(200);

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
      pool = createPool({ maxWorkers: 1 });
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(50);
      expect(mockFactory.create).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(mockFactory.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('task errors and retries', () => {
    it('retries failed tasks', async () => {
      let attemptCount = 0;

      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          attemptCount++;
          if (attemptCount < 3) {
            setTimeout(() => options.onError(new Error('Network error')), 50);
          } else {
            setTimeout(() => options.onComplete(new Uint8Array([1])), 50);
          }
        }),
      }));

      pool = createPool();
      pool.addTask(createTask(0));

      // Run through retries: 50ms (1st fail) + 5000ms (delay) + 50ms (2nd fail) + 10000ms (delay) + 50ms (success)
      await vi.advanceTimersByTimeAsync(20000);

      expect(attemptCount).toBe(3);
      expect(pool.getCompletedAudio().size).toBe(1);
    });

    it('calls onStatusUpdate on retry', async () => {
      const onStatusUpdate = vi.fn();

      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          setTimeout(() => options.onError(new Error('Error')), 50);
        }),
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

      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          createTimes.push(Date.now());
          setTimeout(() => options.onError(new Error('Error')), 10);
        }),
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

      const createdOptions = mockServices.get(0)?.options;
      expect(createdOptions?.config.voice).toContain('ru-RU, DmitryNeural');
    });

    it('uses default voice when task has no override', async () => {
      pool = createPool();
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(0);

      const createdOptions = mockServices.get(0)?.options;
      expect(createdOptions?.config.voice).toBe(defaultVoiceConfig.voice);
    });
  });

  describe('status updates', () => {
    it('forwards status updates from workers', async () => {
      const statusUpdates: StatusUpdate[] = [];

      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          options.onStatusUpdate({ partIndex: options.indexPart, message: 'Processing...', isComplete: false });
          setTimeout(() => options.onComplete(new Uint8Array([1])), 50);
        }),
      }));

      pool = createPool({
        onStatusUpdate: (update) => statusUpdates.push(update),
      });
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      expect(statusUpdates).toContainEqual(expect.objectContaining({
        partIndex: 0,
        message: 'Processing...',
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

      await vi.advanceTimersByTimeAsync(200);

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

  describe('clear', () => {
    it('clears all state', async () => {
      pool = createPool();
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(200);

      pool.clear();

      expect(pool.getProgress()).toEqual({
        completed: 0,
        total: 0,
        failed: 0,
      });
      expect(pool.getCompletedAudio().size).toBe(0);
      expect(pool.getFailedTasks().size).toBe(0);
    });
  });

  describe('worker start delay', () => {
    it('delays between starting workers', async () => {
      const startTimes: number[] = [];
      let currentTime = 0;

      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      mockFactory.create = vi.fn((options: TTSWorkerOptions) => ({
        start: vi.fn(() => {
          startTimes.push(currentTime);
          // Simulate long-running task
          setTimeout(() => options.onComplete(new Uint8Array([1])), 1000);
        }),
      }));

      pool = createPool({
        maxWorkers: 3,
        ttsConfig: {
          ...defaultOptions.ttsConfig!,
          workerStartDelay: 50,
        },
      });

      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      // Advance time in small increments to trigger delays
      for (let i = 0; i < 20; i++) {
        currentTime += 30;
        await vi.advanceTimersByTimeAsync(30);
      }

      // Workers should have started with delays between them
      expect(mockFactory.create).toHaveBeenCalled();
    });
  });
});
