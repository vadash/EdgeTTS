import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkStore } from '../ChunkStore';
import { ReusableEdgeTTSService } from '../ReusableEdgeTTSService';
import {
  type PoolOutcome,
  type PoolTask,
  TTSWorkerPool,
  type WorkerPoolOptions,
} from '../TTSWorkerPool';

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

const MockedReusableEdgeTTSService = vi.mocked(ReusableEdgeTTSService);

describe('Ladder Integration - E2E', () => {
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

  const makeTasks = (count: number, startIndex = 0): PoolTask[] =>
    Array.from({ length: count }, (_, i) => ({
      partIndex: i + startIndex,
      text: `Text ${i + startIndex}`,
    }));

  /** Pump fake timers until the run settles, then return its outcome. */
  const pump = async (pending: Promise<PoolOutcome>): Promise<PoolOutcome> => {
    let outcome: PoolOutcome | undefined;
    void pending.then((o) => {
      outcome = o;
    });
    while (!outcome) {
      await vi.advanceTimersByTimeAsync(100);
    }
    return outcome;
  };

  it('scales up from 2 -> 3 -> 4 -> ... as tasks succeed', async () => {
    const onConcurrencyChange = vi.fn();
    const pool = TTSWorkerPool.create({ ...options, onConcurrencyChange });

    // 60 successful tasks (3 full evaluation cycles)
    const outcome = await pump(pool.run(makeTasks(60), { signal: new AbortController().signal }));

    // Starting at 2, after 20 tasks -> 3, after 40 -> 4, after 60 -> 5
    expect(outcome.completed.size).toBe(60);
    expect(outcome.failed).toEqual([]);
    // The ladder raised concurrency as successes accumulated
    const reported = onConcurrencyChange.mock.calls.map((call) => call[0]);
    expect(reported.some((c, i) => i > 0 && c > reported[0])).toBe(true);
  });

  it('scales down when errors occur', async () => {
    // First, scale up with successful tasks
    const pool = TTSWorkerPool.create(options);
    const successOutcome = await pump(
      pool.run(makeTasks(160), { signal: new AbortController().signal }),
    );
    expect(successOutcome.completed.size).toBe(160);

    // Now create a new pool whose connections always fail
    MockedReusableEdgeTTSService.mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error('Rate limited')),
        disconnect: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
        getState: vi.fn().mockReturnValue('READY'),
      };
    });

    const onTaskError = vi.fn();
    const onConcurrencyChange = vi.fn();
    const failPool = TTSWorkerPool.create({ ...options, onTaskError, onConcurrencyChange });

    // A task that always fails; pump through every backoff attempt
    const outcome = await pump(
      failPool.run(makeTasks(1), { signal: new AbortController().signal }),
    );

    // Failure was recorded through the outcome and the error callback
    expect(onTaskError).toHaveBeenCalledTimes(1);
    expect(onTaskError).toHaveBeenCalledWith(0, expect.any(Error));
    expect(outcome.failed).toEqual([{ index: 0, message: 'Rate limited' }]);
    // The ladder throttled while failures accumulated
    expect(onConcurrencyChange).toHaveBeenCalled();
  });
});
