// TTSWorkerPool - Worker pool using p-queue and generic-pool
// Uses battle-tested libraries for task scheduling and connection management

import { createPool, type Pool } from 'generic-pool';
import PQueue from 'p-queue';
import type { StatusUpdate, TTSConfig as VoiceConfig } from '../state/types';
import type { ChunkStore } from './ChunkStore';
import { LadderController } from './LadderController';
import type { Logger } from './Logger';
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';

export interface PoolTask {
  partIndex: number;
  text: string;
  filename: string;
  filenum: string;
  voice?: string;
}

export interface WorkerPoolProgress {
  completed: number;
  total: number;
  failed: number;
}

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  chunkStore?: ChunkStore | null;
  directoryHandle?: FileSystemDirectoryHandle | null;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskComplete?: (partIndex: number, partIndexStr: string) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
  onConcurrencyChange?: (concurrency: number) => void;
  logger?: Logger;
}

/**
 * TTSWorkerPool - Uses p-queue for task scheduling and generic-pool for connection management
 *
 * Features:
 * - p-queue handles concurrency and task scheduling
 * - generic-pool manages WebSocket connections with acquire/release semantics
 * - Centralized retry logic with exponential backoff via p-retry
 * - Handles sleep mode recovery via reconnection
 * - Writes audio chunks to ChunkStore immediately to prevent OOM
 */
export class TTSWorkerPool {
  private queue: PQueue;
  private connectionPool: Pool<ReusableEdgeTTSService>;
  private ladder: LadderController;
  private completedTasks = new Map<number, string>();
  private failedTasks = new Set<number>();
  private chunkStore: ChunkStore | null = null;

  // Statistics
  private totalTasks = 0;
  private processedCount = 0;
  private maxWorkers: number;

  private voiceConfig: VoiceConfig;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, filename: string) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;
  private logger?: Logger;

  // Retry state management
  private retryCount = new Map<number, number>();
  private retryTimers = new Map<number, NodeJS.Timeout>();

  // Network event handlers
  private handleOnline?: () => void;
  private handleOffline?: () => void;

  // Failure logging
  private failureLogCounter = 0;

  // Options storage for access in tests
  public readonly options: WorkerPoolOptions;

  constructor(options: WorkerPoolOptions) {
    this.voiceConfig = options.config;
    this.chunkStore = options.chunkStore ?? null;
    this.onStatusUpdate = options.onStatusUpdate;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onAllComplete = options.onAllComplete;
    this.logger = options.logger;
    this.maxWorkers = options.maxWorkers;
    this.options = options;

    // Initialize ladder controller for adaptive scaling
    this.ladder = new LadderController(
      {
        sampleSize: 20,
        successThreshold: 0.8, // Drop concurrency if success is < 80%
        scaleUpThreshold: 0.95, // Increase concurrency only if success is >= 95%
        scaleUpIncrement: 2,
        scaleDownFactor: 0.5,
      },
      this.maxWorkers,
      this.logger,
    );

    // Initialize p-queue with ladder's starting concurrency (minWorkers, not maxWorkers)
    this.queue = new PQueue({ concurrency: this.ladder.getCurrentWorkers() });

    // Listen for queue idle to trigger onAllComplete
    this.queue.on('idle', () => {
      if (this.totalTasks > 0 && this.processedCount === this.totalTasks) {
        this.onAllComplete?.();
      }
    });

    // Initialize generic-pool for WebSocket connections
    const logger = this.logger;
    this.connectionPool = createPool(
      {
        create: async (): Promise<ReusableEdgeTTSService> => {
          const service = new ReusableEdgeTTSService(logger);
          await service.connect();
          return service;
        },
        destroy: async (service: ReusableEdgeTTSService): Promise<void> => {
          service.disconnect();
        },
        validate: async (service: ReusableEdgeTTSService): Promise<boolean> => {
          return service.isReady();
        },
      },
      {
        max: options.maxWorkers,
        min: 0, // Create connections on demand
        testOnBorrow: true, // Validate connection before use
        // Note: evictionRunIntervalMillis disabled - uses Node.js setTimeout().unref()
        // which doesn't exist in browsers. Idle connections cleaned up via cleanup() instead.
      },
    );

    // Network Offline/Online Handling - pause queue when offline to preserve retry budget
    this.handleOnline = () => {
      this.logger?.info('Network restored. Resuming TTS queue.');
      this.queue.start();
    };
    this.handleOffline = () => {
      this.logger?.warn('Network disconnected. Pausing TTS queue.');
      this.queue.pause();
    };
    // Guard browser globals for jsdom compatibility
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }

    // Pause immediately if starting offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.logger?.warn('Started offline. TTS queue paused.');
      this.queue.pause();
    }
  }

  /**
   * Pre-warm connections before adding tasks
   */
  async warmup(): Promise<void> {
    const promises: Promise<void>[] = [];
    const workersToWarmup = this.ladder.getCurrentWorkers();

    for (let i = 0; i < workersToWarmup; i++) {
      promises.push(
        (async () => {
          try {
            const conn = await this.connectionPool.acquire();
            await this.connectionPool.release(conn);
          } catch {
            // Ignore warmup errors - will retry on actual task
          }
        })(),
      );
    }
    await Promise.allSettled(promises);
    this.logger?.debug(`Warmed up ${workersToWarmup} connections (ladder-controlled)`);
    this.options.onConcurrencyChange?.(workersToWarmup);
  }

  addTask(task: PoolTask): void {
    this.totalTasks++;
    // Wait for init before processing
    this.queue.add(() => this.executeTask(task));
  }

  addTasks(tasks: PoolTask[]): void {
    this.totalTasks += tasks.length;

    // Let p-queue handle the concurrency. No manual batching needed.
    for (const task of tasks) {
      this.queue.add(() => this.executeTask(task));
    }
  }

  /**
   * Executes a single task with direct error handling (no withRetry wrapper)
   * Acquires connection from pool, executes, releases back
   */
  private async executeTask(task: PoolTask): Promise<void> {
    // Acquire connection from pool
    let service: ReusableEdgeTTSService | null = null;

    try {
      service = await this.connectionPool.acquire();

      this.onStatusUpdate?.({
        partIndex: task.partIndex,
        message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Processing...`,
        isComplete: false,
      });

      // Build config with task-specific voice
      const taskConfig: VoiceConfig = task.voice
        ? {
            ...this.voiceConfig,
            voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})`,
          }
        : this.voiceConfig;

      // Ensure connected (Reusable service handles idempotency)
      // If PC slept, state is likely disconnected, this reconnects.
      if (!service.isReady()) {
        await service.connect();
      }

      // Send request directly (no withRetry wrapper)
      const audioData = await service.send({
        text: task.text,
        config: taskConfig,
      });

      // Save to ChunkStore
      await this.chunkStore!.writeChunk(task.partIndex, audioData);

      // Post-cancellation safety check: skip state updates if pool was cleared
      if (this.totalTasks > 0) {
        // Read actual retry count from Map (defaults to 0 if not tracked)
        const actualRetries = this.retryCount.get(task.partIndex) ?? 0;

        // Record success for ladder with actual retry count
        this.ladder.recordTask(true, actualRetries);
        this.ladder.evaluate();

        // Sync p-queue concurrency with the ladder
        this.queue.concurrency = this.ladder.getCurrentWorkers();

        // Notify about concurrency change
        this.options.onConcurrencyChange?.(this.queue.concurrency);

        // Store part index as string reference for compatibility
        this.completedTasks.set(task.partIndex, String(task.partIndex));
        this.processedCount++;

        this.onStatusUpdate?.({
          partIndex: task.partIndex,
          message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Complete`,
          isComplete: true,
        });

        this.onTaskComplete?.(task.partIndex, String(task.partIndex));
      }

      // Cleanup: delete retryCount to prevent memory leaks
      this.retryCount.delete(task.partIndex);

      // Release connection back to pool on success
      await this.connectionPool.release(service);
    } catch (error) {
      // Destroy connection on failure (not release)
      if (service) {
        try {
          await this.connectionPool.destroy(service);
        } catch {
          // Socket may already be dead - ignore error
        }
      }

      // Post-cancellation safety check: skip state updates if pool was cleared
      if (this.totalTasks > 0) {
        // Delegate to handleTaskFailure for retry logic
        await this.handleTaskFailure(task, error);
      }
    }
  }

  getCompletedAudio(): Map<number, string> {
    return new Map(this.completedTasks);
  }

  getFailedTasks(): Set<number> {
    return new Set(this.failedTasks);
  }

  getProgress(): WorkerPoolProgress {
    return {
      completed: this.processedCount,
      total: this.totalTasks,
      failed: this.failedTasks.size,
    };
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): { total: number; ready: number; busy: number; disconnected: number } {
    // generic-pool provides: size (total created), available (idle), borrowed (in use), pending (waiting)
    const poolSize = this.connectionPool.size;
    const available = this.connectionPool.available;
    const borrowed = this.connectionPool.borrowed;

    return {
      total: this.maxWorkers,
      ready: available,
      busy: borrowed,
      disconnected: this.maxWorkers - poolSize,
    };
  }

  /**
   * Calculate retry delay with custom progression and jitter
   * Progression: 1.5-3s → 5-10s → 15-30s → 30-60s → 60-120s (capped)
   * Uses half-max jitter to prevent thundering herd (baseDelay/2 to baseDelay)
   * @param attempt - Retry attempt number (1-indexed, max 5)
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const delays = [3_000, 10_000, 30_000, 60_000, 120_000]; // 3s, 10s, 30s, 60s, 120s
    const baseDelay = delays[Math.min(attempt - 1, delays.length - 1)];
    const halfDelay = baseDelay / 2;
    const jitter = Math.random() * halfDelay;

    return halfDelay + jitter;
  }

  /**
   * Handle task failure with retry state management and permanent failure handling
   * @param task - The failed task
   * @param error - The error that caused the failure
   */
  private async handleTaskFailure(task: PoolTask, error: unknown): Promise<void> {
    // Get current retry count (default to 0 if not tracked)
    const currentCount = this.retryCount.get(task.partIndex) ?? 0;
    const attempt = currentCount + 1;

    // Update retry count
    this.retryCount.set(task.partIndex, attempt);

    // Record intermediate failures to ladder for immediate throttling
    // This happens BEFORE the max retries check so rate limits are caught early
    this.ladder.recordTask(false, attempt);
    this.ladder.evaluate();
    this.queue.concurrency = this.ladder.getCurrentWorkers();
    this.options.onConcurrencyChange?.(this.queue.concurrency);

    // Check if we've exceeded max retries
    if (attempt > 5) {
      // Log the failure for debugging
      await this.logTTSFailure(task, error);

      // Permanent failure - already recorded above
      // Add to failed tasks
      this.failedTasks.add(task.partIndex);
      this.processedCount++;

      // Call error callback
      this.onTaskError?.(task.partIndex, error instanceof Error ? error : new Error(String(error)));

      this.logger?.error(
        `Task ${task.partIndex} failed permanently after 5 attempts`,
        error as Error,
      );

      // Cleanup: delete retryCount to prevent memory leaks
      this.retryCount.delete(task.partIndex);
      return;
    }

    // Calculate delay for this attempt
    const delay = this.calculateRetryDelay(attempt);

    // Fire status update with delay info
    this.onStatusUpdate?.({
      partIndex: task.partIndex,
      message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Retry in ${Math.round(delay / 1000)}s...`,
      isComplete: false,
    });

    this.logger?.warn(
      `Task ${task.partIndex} failed (attempt ${attempt}/5). Retrying in ${Math.round(delay / 1000)}s`,
    );

    // Schedule retry with setTimeout
    const timer = setTimeout(() => {
      this.requeueTask(task);
    }, delay);

    // Store timer in retryTimers for potential cancellation
    this.retryTimers.set(task.partIndex, timer);
  }

  /**
   * Re-enqueue a failed task back to the queue after its delay expires
   * @param task - The task to re-enqueue
   */
  private requeueTask(task: PoolTask): void {
    // Fire status update
    this.onStatusUpdate?.({
      partIndex: task.partIndex,
      message: 'Retrying now...',
      isComplete: false,
    });

    // Add task back to queue
    this.queue.add(() => this.executeTask(task));

    // Delete the timer from retryTimers
    this.retryTimers.delete(task.partIndex);
  }

  /**
   * Log TTS failure to a file in the logs directory
   * @param task - The failed task
   * @param error - The error that caused the failure
   */
  private async logTTSFailure(task: PoolTask, error: unknown): Promise<void> {
    try {
      // Return early if no directory handle is available
      if (!this.options.directoryHandle) {
        return;
      }

      // Get or create the logs subdirectory
      const logsDir = await this.options.directoryHandle.getDirectoryHandle('logs', {
        create: true,
      });

      // Increment the failure log counter
      this.failureLogCounter++;

      // Create the failure log file
      const fileName = `tts_fail${this.failureLogCounter}.json`;
      const fileHandle = await logsDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();

      // Extract error message from Error or string
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Write the log entry as JSON
      const logEntry = {
        partIndex: task.partIndex,
        text: task.text,
        errorMessage,
        retryCount: 5,
        timestamp: new Date().toISOString(),
      };

      await writable.write(JSON.stringify(logEntry, null, 2));
      await writable.close();
    } catch (err) {
      // Non-fatal: log the error but don't throw
      this.logger?.warn('Failed to write TTS failure log', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Cleanup - close chunkStore and drain connection pool
   */
  async cleanup(): Promise<void> {
    // Remove network event listeners
    if (typeof window !== 'undefined') {
      if (this.handleOnline) window.removeEventListener('online', this.handleOnline);
      if (this.handleOffline) window.removeEventListener('offline', this.handleOffline);
    }

    // Clear pending retry timers to prevent ghost tasks from waking after cancellation
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCount.clear();

    // Drain and clear the connection pool
    try {
      await this.connectionPool.drain();
      await this.connectionPool.clear();
    } catch (err) {
      this.logger?.warn(`Failed to drain connection pool: ${(err as Error).message}`);
    }

    // Close ChunkStore
    if (this.chunkStore) {
      try {
        await this.chunkStore.close();
        this.logger?.debug('Closed ChunkStore');
      } catch (err) {
        this.logger?.warn(`Failed to close ChunkStore: ${(err as Error).message}`);
      }
    }
  }

  clear(): void {
    // Remove network event listeners
    if (typeof window !== 'undefined') {
      if (this.handleOnline) window.removeEventListener('online', this.handleOnline);
      if (this.handleOffline) window.removeEventListener('offline', this.handleOffline);
    }

    // Clear pending retry timers to prevent ghost tasks from waking after cancellation
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCount.clear();

    // Clear the p-queue
    this.queue.clear();

    // Drain connection pool (async, but we don't wait)
    this.connectionPool
      .drain()
      .then(() => this.connectionPool.clear())
      .catch(() => {});

    this.completedTasks.clear();
    this.failedTasks.clear();
    this.totalTasks = 0;
    this.processedCount = 0;
  }
}
