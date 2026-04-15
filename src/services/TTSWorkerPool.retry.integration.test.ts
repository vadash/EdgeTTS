/**
 * Integration tests for retry behavior under network failure conditions.
 *
 * These tests verify that when tasks fail due to network issues:
 * - Workers are not blocked (queue concurrency is available)
 * - Healthy tasks continue processing while failed tasks are in retry timers
 * - Failed tasks are re-executed after retry delay expires
 * - Status updates fire at expected times (failure, retry delay, re-execution)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusUpdate, TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import type { ChunkStore } from './ChunkStore';
import { type PoolTask, TTSWorkerPool, type WorkerPoolOptions } from './TTSWorkerPool';

// Mock p-queue with proper async handling for timer-based requeues
vi.mock('p-queue', () => ({
  default: class MockPQueue {
    concurrency = 1;
    private listeners: Map<string, Array<() => void>> = new Map();

    async add(fn: () => Promise<unknown>) {
      const result = await fn();
      // Trigger idle event after task completes
      setTimeout(() => {
        const idleListeners = this.listeners.get('idle') || [];
        for (const listener of idleListeners) {
          void listener();
        }
      }, 0);
      return result;
    }

    clear() {
      // Clear any pending state
    }

    on(event: string, listener: () => void) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event)!.push(listener);
    }

    get size() {
      return 0;
    }

    get pending() {
      return 0;
    }
  },
}));

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

import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';
const MockedReusableEdgeTTSService = vi.mocked(ReusableEdgeTTSService);

describe('TTSWorkerPool - Retry Integration Tests (Network Failures)', () => {
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
      maxWorkers: 2, // Small pool for easier testing
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

  describe('batch network failures with worker availability', () => {
    it('should not block workers when multiple tasks fail simultaneously - queue concurrency is available', async () => {
      const statusUpdates: StatusUpdate[] = [];
      const onStatusUpdate = vi.fn((update: StatusUpdate) => {
        statusUpdates.push(update);
      });

      pool = createPool({ onStatusUpdate });

      // Make first 2 tasks fail, third task succeed
      let callCount = 0;
      mockSend.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Network error');
        }
        return new Uint8Array([1, 2, 3]);
      });

      // Add tasks - they will be processed concurrently up to maxWorkers
      pool.addTasks([createTask(0), createTask(1), createTask(2)]);

      // Let initial processing happen
      await vi.advanceTimersByTimeAsync(100);

      // Tasks 0 and 1 should have failed and be in retry state
      // Task 2 should have succeeded
      expect(pool.getProgress().completed).toBe(1);
      expect(pool.getProgress().failed).toBe(0); // Not permanently failed yet

      // Workers should be free (not blocked by retry timers)
      // @ts-expect-error - accessing private property for testing
      const retryTimers = pool.retryTimers;
      expect(retryTimers.size).toBe(2); // Two retry timers scheduled

      // Add a new healthy task - it should be processed immediately
      // since workers are not blocked
      mockSend.mockResolvedValueOnce(new Uint8Array([4, 5, 6]));
      pool.addTask(createTask(3));

      await vi.advanceTimersByTimeAsync(100);

      // Task 3 should complete immediately, proving workers weren't blocked
      expect(pool.getProgress().completed).toBe(2);
    });

    it('should allow healthy tasks to process while failed tasks are in retry timers', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      // Task 0 fails initially
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      pool.addTask(createTask(0));

      // Let the failure happen
      await vi.advanceTimersByTimeAsync(100);

      // Task should be in retry state
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(1);

      // Now add a healthy task while task 0 is in retry
      mockSend.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
      pool.addTask(createTask(1));

      // Task 1 should complete immediately, not blocked by task 0's retry timer
      await vi.advanceTimersByTimeAsync(100);

      expect(onTaskComplete).toHaveBeenCalledWith(1, '1');
      expect(pool.getProgress().completed).toBe(1);
    });

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

      // Should have a retry timer scheduled
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(1);

      // Manually trigger the requeue to simulate timer expiration
      // This bypasses the complex fake timer + mock queue interaction
      // @ts-expect-error - calling private method for testing
      await pool.requeueTask(task);

      // Wait for requeued task to execute
      await vi.advanceTimersByTimeAsync(100);

      // Task should now complete successfully
      expect(onTaskComplete).toHaveBeenCalledWith(0, '0');
      expect(pool.getProgress().completed).toBe(1);

      // No permanent failure
      expect(onTaskError).not.toHaveBeenCalled();
      expect(pool.getProgress().failed).toBe(0);
    });

    it('should fire status updates at expected times during retry cycle', async () => {
      const statusUpdates: StatusUpdate[] = [];
      const onStatusUpdate = vi.fn((update: StatusUpdate) => {
        statusUpdates.push(update);
      });

      pool = createPool({ onStatusUpdate });

      // First call fails
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      pool.addTask(createTask(0));

      // Clear initial status updates
      statusUpdates.length = 0;

      // Let the failure happen
      await vi.advanceTimersByTimeAsync(100);

      // Should get a status update for retry
      const retryUpdate = statusUpdates.find(
        (u) => u.partIndex === 0 && u.message.includes('Retry in'),
      );
      expect(retryUpdate).toBeDefined();
      expect(retryUpdate?.message).toContain('Retry in');

      // Clear for next check
      statusUpdates.length = 0;

      // Manually trigger requeue to simulate timer expiration
      // @ts-expect-error - calling private method for testing
      await pool.requeueTask(createTask(0));

      // Wait for requeued task to execute
      await vi.advanceTimersByTimeAsync(100);

      // Should get status update for re-execution ("Retrying now...")
      const reexecUpdate = statusUpdates.find(
        (u) => u.partIndex === 0 && u.message.includes('Retrying now'),
      );
      expect(reexecUpdate).toBeDefined();

      // Should get completion update (when we make send succeed)
      mockSend.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
      // @ts-expect-error - calling private method for testing
      await pool.requeueTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);

      const completeUpdate = statusUpdates.find(
        (u) => u.partIndex === 0 && u.message.includes('Complete'),
      );
      expect(completeUpdate).toBeDefined();
    });

    it('should handle multiple retry cycles for the same task', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      const task = createTask(0);

      // Simulate multiple failures by calling handleTaskFailure directly
      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Network error 1'));
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.get(task.partIndex)).toBe(1);

      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Network error 2'));
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.get(task.partIndex)).toBe(2);

      // Verify requeueTask is called when timer fires (via handleTaskFailure)
      // The actual requeue would happen via setTimeout, but we verify the timer is set
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.has(task.partIndex)).toBe(true);

      // The test verifies that multiple retry cycles increment the counter correctly
      // and that timers are scheduled. Actual execution is tested in other tests.
    });

    it('should mark task as permanently failed after max retries', async () => {
      const onTaskError = vi.fn();
      pool = createPool({ onTaskError });

      const task = createTask(0);

      // Set retry count to exceed max (11 is the max, so 12 triggers permanent failure)
      // @ts-expect-error - accessing private property for testing
      pool.retryCount.set(task.partIndex, 11);

      // Call handleTaskFailure which should detect max retries exceeded
      // @ts-expect-error - calling private method for testing
      await pool.handleTaskFailure(task, new Error('Persistent network error'));

      // Should be permanently failed
      expect(onTaskError).toHaveBeenCalled();
      expect(pool.getProgress().failed).toBe(1);

      // No retry timer should be active
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);

      // retryCount should be deleted to prevent memory leaks
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.has(task.partIndex)).toBe(false);
    });

    it('should process multiple failed tasks independently', async () => {
      const onTaskComplete = vi.fn();
      pool = createPool({ onTaskComplete });

      // Add tasks through normal flow - task 0 and 1 will fail initially
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

      // Tasks 0 and 1 should have retry timers scheduled
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(2);

      // Now make the retry attempts succeed
      mockSend.mockResolvedValue(new Uint8Array([1, 2, 3]));

      // Manually trigger requeue for both tasks to simulate timer expiration
      // @ts-expect-error - calling private method for testing
      await pool.requeueTask(createTask(0));
      await vi.advanceTimersByTimeAsync(100);

      // @ts-expect-error - calling private method for testing
      await pool.requeueTask(createTask(1));
      await vi.advanceTimersByTimeAsync(100);

      // All tasks should now be complete
      expect(pool.getProgress().completed).toBe(3);
      expect(pool.getProgress().failed).toBe(0);
    });
  });

  describe('retry timer cleanup', () => {
    it('should clear retry timers on cleanup', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      pool = createPool();

      // Make task fail
      mockSend.mockRejectedValueOnce(new Error('Network error'));
      pool.addTask(createTask(0));

      await vi.advanceTimersByTimeAsync(100);

      // Should have a retry timer
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(1);

      // Clear the spy to track only cleanup calls
      clearTimeoutSpy.mockClear();

      // Cleanup the pool
      await pool.cleanup();

      // Should have called clearTimeout for the retry timer
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);
    });

    it('should clear retry timers on pool clear', async () => {
      pool = createPool();

      // Make tasks fail
      mockSend.mockRejectedValue(new Error('Network error'));
      pool.addTasks([createTask(0), createTask(1)]);

      await vi.advanceTimersByTimeAsync(100);

      // Should have retry timers
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(2);

      // Clear the pool
      pool.clear();

      // Timers should be cleared
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryTimers.size).toBe(0);
      // @ts-expect-error - accessing private property for testing
      expect(pool.retryCount.size).toBe(0);
    });
  });
});
