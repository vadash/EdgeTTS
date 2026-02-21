import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TTSWorkerPool, type WorkerPoolOptions, type PoolTask } from './TTSWorkerPool';
import type { TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';

vi.mock('./ReusableEdgeTTSService', () => ({
  ReusableEdgeTTSService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    disconnect: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue('READY'),
  })),
}));

describe('TTSWorkerPool - Ladder Integration', () => {
  let pool: TTSWorkerPool;
  let options: WorkerPoolOptions;
  let mockDir: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDir = createMockDirectoryHandle();

    options = {
      maxWorkers: 10,
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

  it('warmup uses ladder workers (2), not maxWorkers', async () => {
    pool = new TTSWorkerPool(options);

    // Spy on connectionPool.acquire
    const acquireSpy = vi.spyOn(pool['connectionPool'], 'acquire');

    await pool.warmup();

    // Should warm up 2 connections (ladder min), not 10
    expect(acquireSpy).toHaveBeenCalledTimes(2);
  });

  it('has ladder controller instance', async () => {
    pool = new TTSWorkerPool(options);

    // Check that ladder exists internally
    expect(pool['ladder']).toBeDefined();
    expect(pool['ladder'].getCurrentWorkers()).toBe(2);
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

  it('records failed task for ladder evaluation', async () => {
    // Mock send to fail
    const { ReusableEdgeTTSService } = await import('./ReusableEdgeTTSService');
    vi.mocked(ReusableEdgeTTSService).mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockRejectedValue(new Error('Rate limited')),
      disconnect: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('READY'),
    }));

    pool = new TTSWorkerPool(options);

    const task: PoolTask = {
      partIndex: 0,
      text: 'Test text',
      filename: 'test',
      filenum: '0001',
    };

    pool.addTask(task);

    // Wait for task to fail (with retries)
    await vi.advanceTimersByTimeAsync(5000);

    const progress = pool.getProgress();
    // Should fail after max retries
    expect(progress.failed).toBeGreaterThanOrEqual(1);
  });
});
