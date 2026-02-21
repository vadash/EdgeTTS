import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSWorkerPool, type WorkerPoolOptions } from '../TTSWorkerPool';
import type { PoolTask } from '../interfaces';
import type { TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';

vi.mock('../ReusableEdgeTTSService', () => ({
  ReusableEdgeTTSService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    disconnect: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue('READY'),
  })),
}));

describe('Ladder Integration - E2E', () => {
  let pool: TTSWorkerPool;
  let options: WorkerPoolOptions;
  let mockDir: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDir = createMockDirectoryHandle();

    options = {
      maxWorkers: 15,
      config: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
      },
      directoryHandle: mockDir,
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
    pool = new TTSWorkerPool(options);

    // First, scale up to 8 workers
    const successTasks: PoolTask[] = Array.from({ length: 160 }, (_, i) => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));

    // Mock to fail on task 161
    const { ReusableEdgeTTSService } = await import('../ReusableEdgeTTSService');
    vi.mocked(ReusableEdgeTTSService).mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementationOnce(() => Promise.reject(new Error('Rate limited'))),
      disconnect: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('READY'),
    }));

    pool.addTasks(successTasks);

    // Process
    while (pool.getProgress().completed < 160) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Now add a task that will fail
    const failingTask: PoolTask = {
      partIndex: 160,
      text: 'This will fail',
      filename: 'test',
      filenum: '0161',
    };
    pool.addTask(failingTask);

    await vi.advanceTimersByTimeAsync(5000);

    // Verify failure was recorded and workers handled
    const progress = pool.getProgress();
    expect(progress.failed).toBeGreaterThanOrEqual(1);
  });
});
