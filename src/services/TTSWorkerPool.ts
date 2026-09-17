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
 * One-shot pool: one conversion run per instance. A second run() does no
 * work because executeTask drops tasks once the pool has settled.
 */
export class TTSWorkerPool {
  static create(config: WorkerPoolOptions): TTSWorkerPool {
    return new TTSWorkerPool(config);
  }

  private queue: PQueue;
  private connectionPool: Pool<ReusableEdgeTTSService>;
  private ladder: LadderController;
  private completed = new Set<number>();
  private failed: Array<{ index: number; message: string }> = [];
  private chunkStore: ChunkStore | null = null;

  private totalTasks = 0;
  private processedCount = 0;
  private maxWorkers: number;

  private voiceConfig: VoiceConfig;
  private onTaskComplete?: (partIndex: number) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onRetry?: (partIndex: number, attempt: number, delayMs: number) => void;
  private onConcurrencyChange?: (concurrency: number) => void;
  private logger?: ILogger;

  private retryCount = new Map<number, number>();
  private retryTimers = new Map<number, NodeJS.Timeout>();

  private handleOnline?: () => void;
  private handleOffline?: () => void;

  // Connections executing a send (sockets destroyed on abort)
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

    this.ladder = new LadderController(
      {
        sampleSize: 20,
        successThreshold: 0.8,
        scaleUpThreshold: 0.95,
        scaleUpIncrement: 2,
        scaleDownFactor: 0.5,
      },
      this.maxWorkers,
      this.logger,
    );

    // Start at the ladder's current concurrency, not maxWorkers
    this.queue = new PQueue({ concurrency: this.ladder.getCurrentWorkers() });

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
        // Do not set evictionRunIntervalMillis: it relies on Node.js
        // setTimeout().unref(), which browsers lack. Idle connections are
        // reclaimed by the pool's idle timeout after run() settles.
      },
    );

    // Pause the queue while offline to preserve the retry budget
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
   * Runs one task to a terminal state. Retry and permanent-failure decisions
   * live here, not in the shared withRetry wrapper.
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

      const taskConfig: VoiceConfig = task.voice
        ? {
            ...this.voiceConfig,
            voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})`,
          }
        : this.voiceConfig;

      // connect() is idempotent; a suspended PC or network drop leaves the
      // state DISCONNECTED, so reconnect before sending.
      if (!service.isReady()) {
        await service.connect();
      }

      const audioData = await service.send({
        text: task.text,
        config: taskConfig,
      });
      if (this.settled) {
        // Cancelled run writes no progress
        await this.destroyConnection(service);
        return;
      }

      // Write the chunk to the Chunk store immediately so audio never
      // accumulates in memory (ADR-0002).
      await this.chunkStore!.writeChunk(task.partIndex, audioData);
      if (this.settled) {
        // Cancelled run writes no progress
        await this.destroyConnection(service);
        return;
      }

      const actualRetries = this.retryCount.get(task.partIndex) ?? 0;

      this.ladder.recordTask(true, actualRetries);
      this.ladder.evaluate();

      this.queue.concurrency = this.ladder.getCurrentWorkers();
      this.onConcurrencyChange?.(this.queue.concurrency);

      this.completed.add(task.partIndex);
      this.processedCount++;

      this.retryCount.delete(task.partIndex);

      this.onTaskComplete?.(task.partIndex);

      await this.connectionPool.release(service);
      this.inFlight.delete(service);

      this.checkSettled?.();
    } catch (error) {
      if (service) {
        await this.destroyConnection(service);
      }
      if (this.settled) return;

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
      // The socket may already be dead, so ignore destroy errors.
    }
  }

  /**
   * Delay for one retry attempt: half the base delay plus jitter up to half
   * again, so simultaneous failures do not retry as one thundering herd.
   * @param attempt - 1-indexed retry attempt number
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const delays = [3_000, 10_000, 30_000, 60_000, 120_000];
    const baseDelay = delays[Math.min(attempt - 1, delays.length - 1)];
    const halfDelay = baseDelay / 2;
    const jitter = Math.random() * halfDelay;

    return halfDelay + jitter;
  }

  private async handleTaskFailure(task: PoolTask, error: unknown): Promise<void> {
    const currentCount = this.retryCount.get(task.partIndex) ?? 0;
    const attempt = currentCount + 1;

    this.retryCount.set(task.partIndex, attempt);

    // Record the failure with the ladder before the max-retries check so the
    // first failure already throttles concurrency.
    this.ladder.recordTask(false, attempt);
    this.ladder.evaluate();
    this.queue.concurrency = this.ladder.getCurrentWorkers();
    this.onConcurrencyChange?.(this.queue.concurrency);

    if (attempt > MAX_TTS_RETRIES) {
      this.failed.push({ index: task.partIndex, message: getErrorMessage(error) });
      this.processedCount++;

      this.onTaskError?.(task.partIndex, error instanceof Error ? error : new Error(String(error)));

      this.logger?.error(
        `Task ${task.partIndex} failed permanently after ${MAX_TTS_RETRIES} attempts`,
        error as Error,
      );

      this.retryCount.delete(task.partIndex);
      return;
    }

    const delay = this.calculateRetryDelay(attempt);

    this.onRetry?.(task.partIndex, attempt, delay);

    this.logger?.warn(
      `Task ${task.partIndex} failed (attempt ${attempt}/${MAX_TTS_RETRIES}). Retrying in ${Math.round(delay / 1000)}s`,
    );

    const timer = setTimeout(() => {
      this.retryTimers.delete(task.partIndex);
      if (this.settled) return;
      this.queue.add(() => this.executeTask(task));
    }, delay);

    // Store timer in retryTimers for cancellation
    this.retryTimers.set(task.partIndex, timer);
  }

  private teardown(): void {
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
   * Settle-path teardown: the shared teardown, then a graceful socket pool
   * drain before run() resolves.
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
