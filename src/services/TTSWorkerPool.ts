// TTSWorkerPool - one-shot TTS pool protocol (ADR-0018)
// create(config) starts a pool; run(tasks, { signal }) drives a batch to
// completion and settles with a PoolOutcome. p-queue schedules tasks,
// generic-pool manages WebSocket connections, the LadderController scales
// concurrency from observed success.

import { createPool, type Pool } from 'generic-pool';
import PQueue from 'p-queue';
import { CancellationError, getErrorMessage } from '@/errors';
import type { TTSConfig as VoiceConfig } from '../state/types';
import type { ChunkStore } from './ChunkStore';
import { LadderController } from './LadderController';
import type { ILogger } from './Logger';
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';

// Maximum retry attempts per task before permanent failure
const MAX_TTS_RETRIES = 5;

export interface PoolTask {
  partIndex: number;
  text: string;
  voice?: string;
}

/** Terminal state of a run(): chunk indices that completed and permanent failures. */
export interface PoolOutcome {
  completed: Set<number>;
  failed: Array<{ index: number; message: string }>;
}

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  chunkStore?: ChunkStore | null;
  onTaskComplete?: (partIndex: number) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onRetry?: (partIndex: number, attempt: number, delayMs: number) => void;
  onConcurrencyChange?: (concurrency: number) => void;
  logger?: ILogger;
}

/**
 * TTSWorkerPool - one-shot pool for a single conversion run
 *
 * Features:
 * - p-queue handles concurrency and task scheduling
 * - generic-pool manages WebSocket connections with acquire/release semantics
 * - Centralized retry logic with exponential backoff
 * - Handles sleep mode recovery via reconnection
 * - Writes audio chunks to ChunkStore immediately to prevent OOM
 * - run() settles when the queue drains (resolving PoolOutcome) or rejects
 *   with CancellationError when the signal aborts (fast teardown, no
 *   graceful drain wait)
 */
export class TTSWorkerPool {
  /** Create a one-shot pool for a single run() */
  static create(config: WorkerPoolOptions): TTSWorkerPool {
    return new TTSWorkerPool(config);
  }

  private queue: PQueue;
  private connectionPool: Pool<ReusableEdgeTTSService>;
  private ladder: LadderController;
  private completed = new Set<number>();
  private failed: Array<{ index: number; message: string }> = [];
  private chunkStore: ChunkStore | null = null;

  // Progress
  private totalTasks = 0;
  private processedCount = 0;
  private maxWorkers: number;

  private voiceConfig: VoiceConfig;
  private onTaskComplete?: (partIndex: number) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onRetry?: (partIndex: number, attempt: number, delayMs: number) => void;
  private onConcurrencyChange?: (concurrency: number) => void;
  private logger?: ILogger;

  // Retry state management
  private retryCount = new Map<number, number>();
  private retryTimers = new Map<number, NodeJS.Timeout>();

  // Network event handlers
  private handleOnline?: () => void;
  private handleOffline?: () => void;

  // Connections currently executing a send (sockets destroyed on abort)
  private inFlight = new Set<ReusableEdgeTTSService>();
  // Set once run() settles or aborts; executeTask stops recording progress
  private settled = false;
  // Installed by run(); fires after each task reaches a terminal state
  private checkSettled: (() => void) | null = null;

  private constructor(options: WorkerPoolOptions) {
    this.voiceConfig = options.config;
    this.chunkStore = options.chunkStore ?? null;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onRetry = options.onRetry;
    this.onConcurrencyChange = options.onConcurrencyChange;
    this.logger = options.logger;
    this.maxWorkers = options.maxWorkers;

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
        // which doesn't exist in browsers. Idle connections are reclaimed by the
        // pool's idle timeout after run() settles.
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
   * Run a batch of tasks to completion.
   *
   * Resolves with the PoolOutcome once every task is completed or permanently
   * failed: the pool then tears itself down (retry timers, offline listeners,
   * socket pool drain) before the promise settles.
   *
   * Rejects with CancellationError when the signal aborts mid-run: in-flight
   * sockets are destroyed, queued and backoff-timer tasks dropped, and the
   * pool tears down without waiting for a graceful drain. Unfinished chunks
   * appear in neither outcome list. A pre-aborted signal rejects without
   * creating any work.
   */
  run(tasks: PoolTask[], { signal }: { signal: AbortSignal }): Promise<PoolOutcome> {
    return new Promise<PoolOutcome>((resolve, reject) => {
      if (signal.aborted) {
        reject(new CancellationError());
        return;
      }

      for (const task of tasks) {
        this.totalTasks++;
        this.queue.add(() => this.executeTask(task));
      }

      const onAbort = () => {
        if (this.settled) return;
        this.settled = true;
        signal.removeEventListener('abort', onAbort);
        // Fast settle: destroy in-flight sockets, drop queued and backoff
        // tasks; never wait for the graceful drain.
        this.teardown();
        this.queue.clear();
        for (const service of this.inFlight) {
          service.disconnect();
        }
        this.inFlight.clear();
        reject(new CancellationError());
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this.checkSettled = () => {
        if (this.settled || this.processedCount !== this.totalTasks) return;
        this.settled = true;
        signal.removeEventListener('abort', onAbort);
        // Drain the socket pool before handing the outcome over.
        this.shutdown().then(
          () => resolve({ completed: new Set(this.completed), failed: [...this.failed] }),
          () => resolve({ completed: new Set(this.completed), failed: [...this.failed] }),
        );
      };

      // An empty batch settles immediately
      this.checkSettled();
    });
  }

  /**
   * Executes a single task with direct error handling (no withRetry wrapper)
   * Acquires connection from pool, executes, releases back
   */
  private async executeTask(task: PoolTask): Promise<void> {
    if (this.settled) return;
    let service: ReusableEdgeTTSService | null = null;

    try {
      service = await this.connectionPool.acquire();
      if (this.settled) {
        await this.destroyConnection(service);
        return;
      }
      this.inFlight.add(service);

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
      if (this.settled) {
        // Cancelled run writes no progress
        await this.destroyConnection(service);
        return;
      }

      // Save to ChunkStore
      await this.chunkStore!.writeChunk(task.partIndex, audioData);
      if (this.settled) {
        // Cancelled run writes no progress
        await this.destroyConnection(service);
        return;
      }

      // Read actual retry count from Map (defaults to 0 if not tracked)
      const actualRetries = this.retryCount.get(task.partIndex) ?? 0;

      // Record success for ladder with actual retry count
      this.ladder.recordTask(true, actualRetries);
      this.ladder.evaluate();

      // Sync p-queue concurrency with the ladder
      this.queue.concurrency = this.ladder.getCurrentWorkers();
      this.onConcurrencyChange?.(this.queue.concurrency);

      this.completed.add(task.partIndex);
      this.processedCount++;

      // Cleanup: delete retryCount to prevent memory leaks
      this.retryCount.delete(task.partIndex);

      this.onTaskComplete?.(task.partIndex);

      // Release connection back to pool on success
      await this.connectionPool.release(service);
      this.inFlight.delete(service);

      this.checkSettled?.();
    } catch (error) {
      if (service) {
        await this.destroyConnection(service);
      }
      if (this.settled) return;

      // Delegate to handleTaskFailure for retry logic
      await this.handleTaskFailure(task, error);
      this.checkSettled?.();
    }
  }

  /** Destroy a borrowed connection (socket may already be dead). */
  private async destroyConnection(service: ReusableEdgeTTSService): Promise<void> {
    this.inFlight.delete(service);
    try {
      await this.connectionPool.destroy(service);
    } catch {
      // Socket may already be dead - ignore error
    }
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
    this.onConcurrencyChange?.(this.queue.concurrency);

    // Check if we've exceeded max retries
    if (attempt > MAX_TTS_RETRIES) {
      // Permanent failure
      this.failed.push({ index: task.partIndex, message: getErrorMessage(error) });
      this.processedCount++;

      // Call error callback with the original error
      this.onTaskError?.(task.partIndex, error instanceof Error ? error : new Error(String(error)));

      this.logger?.error(
        `Task ${task.partIndex} failed permanently after ${MAX_TTS_RETRIES} attempts`,
        error as Error,
      );

      // Cleanup: delete retryCount to prevent memory leaks
      this.retryCount.delete(task.partIndex);
      return;
    }

    // Calculate delay for this attempt
    const delay = this.calculateRetryDelay(attempt);

    this.onRetry?.(task.partIndex, attempt, delay);

    this.logger?.warn(
      `Task ${task.partIndex} failed (attempt ${attempt}/${MAX_TTS_RETRIES}). Retrying in ${Math.round(delay / 1000)}s`,
    );

    // Schedule retry with setTimeout; re-enqueue after the delay expires
    const timer = setTimeout(() => {
      this.retryTimers.delete(task.partIndex);
      if (this.settled) return;
      this.queue.add(() => this.executeTask(task));
    }, delay);

    // Store timer in retryTimers for cancellation
    this.retryTimers.set(task.partIndex, timer);
  }

  /**
   * Shared teardown: remove network listeners and cancel pending retry timers
   */
  private teardown(): void {
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
  }

  /**
   * Internal teardown on the normal settle path: timers, offline listeners,
   * then a graceful socket pool drain.
   */
  private async shutdown(): Promise<void> {
    this.teardown();

    try {
      await this.connectionPool.drain();
      await this.connectionPool.clear();
    } catch (err) {
      this.logger?.warn(`Failed to drain connection pool: ${(err as Error).message}`);
    }
  }
}
