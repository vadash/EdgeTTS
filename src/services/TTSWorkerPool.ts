// TTSWorkerPool - Worker pool using p-queue and generic-pool
// Uses battle-tested libraries for task scheduling and connection management

import PQueue from 'p-queue';
import { createPool, Pool } from 'generic-pool';
import type { TTSConfig as VoiceConfig, StatusUpdate } from '../state/types';
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';
import { LadderController } from './LadderController';
import { withRetry, AbortError } from '@/utils/asyncUtils';
import { isAppError } from '@/errors';
import type { IWorkerPool, PoolTask, WorkerPoolProgress, ILogger } from './interfaces';

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  directoryHandle?: FileSystemDirectoryHandle | null;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskComplete?: (partIndex: number, filename: string) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
  logger?: ILogger;
}

const TEMP_DIR_NAME = '_temp_work';

/**
 * TTSWorkerPool - Uses p-queue for task scheduling and generic-pool for connection management
 *
 * Features:
 * - p-queue handles concurrency and task scheduling
 * - generic-pool manages WebSocket connections with acquire/release semantics
 * - Centralized retry logic with exponential backoff via p-retry
 * - Handles sleep mode recovery via reconnection
 * - Writes audio chunks to disk immediately to prevent OOM
 */
export class TTSWorkerPool implements IWorkerPool {
  private queue: PQueue;
  private connectionPool: Pool<ReusableEdgeTTSService>;
  private ladder: LadderController;
  private completedTasks = new Map<number, string>();
  private failedTasks = new Set<number>();
  private tempDirHandle: FileSystemDirectoryHandle | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private initPromise: Promise<void> | null = null;

  // Statistics
  private totalTasks = 0;
  private processedCount = 0;
  private maxWorkers: number;

  private voiceConfig: VoiceConfig;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, filename: string) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;
  private logger?: ILogger;

  constructor(options: WorkerPoolOptions) {
    this.voiceConfig = options.config;
    this.directoryHandle = options.directoryHandle ?? null;
    this.onStatusUpdate = options.onStatusUpdate;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onAllComplete = options.onAllComplete;
    this.logger = options.logger;
    this.maxWorkers = options.maxWorkers;

    // Initialize ladder controller for adaptive scaling
    this.ladder = new LadderController(
      {
        sampleSize: 20,
        successThreshold: 0.9,
        scaleUpIncrement: 1,
        scaleDownFactor: 0.5,
      },
      this.maxWorkers,
      this.logger
    );

    // Initialize p-queue with concurrency matching worker count
    this.queue = new PQueue({ concurrency: options.maxWorkers });

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
      }
    );

    // Initialize temp directory asynchronously
    this.initPromise = this.initTempDirectory();
  }

  /**
   * Initialize the temp directory for storing audio chunks
   */
  private async initTempDirectory(): Promise<void> {
    if (!this.directoryHandle) {
      throw new Error('Directory handle required for disk-based audio storage');
    }

    try {
      this.tempDirHandle = await this.directoryHandle.getDirectoryHandle(TEMP_DIR_NAME, {
        create: true,
      });
      this.logger?.debug(`Created temp directory: ${TEMP_DIR_NAME}`);
    } catch (err) {
      this.logger?.error(`Failed to create temp directory: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Write audio chunk to disk
   */
  private async writeChunkToDisk(partIndex: number, audioData: Uint8Array): Promise<string> {
    if (!this.tempDirHandle) {
      throw new Error('Temp directory not initialized');
    }

    const filename = `chunk_${String(partIndex).padStart(6, '0')}.bin`;
    const fileHandle = await this.tempDirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
    const buffer = new ArrayBuffer(audioData.byteLength);
    new Uint8Array(buffer).set(audioData);
    await writable.write(buffer);
    await writable.close();

    return filename;
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
        })()
      );
    }
    await Promise.allSettled(promises);
    this.logger?.debug(`Warmed up ${workersToWarmup} connections (ladder-controlled)`);
  }

  addTask(task: PoolTask): void {
    this.totalTasks++;
    // Wait for init before processing
    this.queue.add(() => this.executeTask(task));
  }

  addTasks(tasks: PoolTask[]): void {
    this.totalTasks += tasks.length;

    // Add tasks gradually based on current ladder setting
    const currentWorkers = this.ladder.getCurrentWorkers();
    const batchSize = currentWorkers;

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      for (const task of batch) {
        this.queue.add(() => this.executeTask(task));
      }

      // After each batch, pause briefly before next batch
      if (i + batchSize < tasks.length) {
        setTimeout(() => {
          // Next batch will be processed after this delay
        }, 100);
      }
    }
  }

  /**
   * Executes a single task with retry logic
   * Acquires connection from pool, executes, releases back
   */
  private async executeTask(task: PoolTask): Promise<void> {
    // Wait for temp directory initialization
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }

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
        ? { ...this.voiceConfig, voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})` }
        : this.voiceConfig;

      // === CENTRALIZED RETRY LOGIC ===
      // This handles: Sleep mode disconnects, Rate limits, Network drops
      const currentService = service; // Capture for closure
      const audioData = await withRetry(
        async () => {
          // Ensure connected (Reusable service handles idempotency)
          // If PC slept, state is likely disconnected, this reconnects.
          if (!currentService.isReady()) {
            await currentService.connect();
          }

          // Send request
          return await currentService.send({
            text: task.text,
            config: taskConfig,
          });
        },
        {
          maxRetries: 11, // Try for 1 hour in total then skip
          baseDelay: 10 * 1000,
          maxDelay: 600 * 1000,
          shouldRetry: (error) => {
            // Only stop for explicit cancellation - retry everything else forever
            if (error instanceof AbortError) return false;
            if (isAppError(error) && error.isCancellation()) return false;
            return true;
          },
          onRetry: (attempt, err, delay) => {
            this.logger?.warn(
              `Retrying task ${task.partIndex} (Attempt ${attempt}). Waiting ${Math.round(delay)}ms. Error: ${err}`
            );

            this.onStatusUpdate?.({
              partIndex: task.partIndex,
              message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Retry ${attempt}...`,
              isComplete: false,
            });

            // Force disconnect on error to ensure clean state for next attempt
            currentService.disconnect();
          },
        }
      );

      // Save to disk
      const filename = await this.writeChunkToDisk(task.partIndex, audioData);

      // Record success for ladder
      this.ladder.recordTask(true, 0);
      this.ladder.evaluate();

      this.completedTasks.set(task.partIndex, filename);
      this.processedCount++;

      this.onStatusUpdate?.({
        partIndex: task.partIndex,
        message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Complete`,
        isComplete: true,
      });

      this.onTaskComplete?.(task.partIndex, filename);
    } catch (error) {
      // Record failure for ladder
      this.ladder.recordTask(false, 11); // Max retries attempted
      this.ladder.evaluate();

      this.failedTasks.add(task.partIndex);
      this.processedCount++;
      this.onTaskError?.(task.partIndex, error instanceof Error ? error : new Error(String(error)));
      this.logger?.error(`Task ${task.partIndex} failed permanently`, error as Error);
    } finally {
      // Release connection back to pool
      if (service) {
        try {
          await this.connectionPool.release(service);
        } catch {
          // Connection may have been destroyed during retry
        }
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

  getTempDirHandle(): FileSystemDirectoryHandle | null {
    return this.tempDirHandle;
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
   * Cleanup temp directory and remove all temp files
   */
  async cleanup(): Promise<void> {
    // Drain and clear the connection pool
    try {
      await this.connectionPool.drain();
      await this.connectionPool.clear();
    } catch (err) {
      this.logger?.warn(`Failed to drain connection pool: ${(err as Error).message}`);
    }

    if (this.directoryHandle && this.tempDirHandle) {
      try {
        await this.directoryHandle.removeEntry(TEMP_DIR_NAME, { recursive: true });
        this.logger?.debug(`Cleaned up temp directory: ${TEMP_DIR_NAME}`);
      } catch (err) {
        this.logger?.warn(`Failed to cleanup temp directory: ${(err as Error).message}`);
      }
      this.tempDirHandle = null;
    }
  }

  clear(): void {
    // Clear the p-queue
    this.queue.clear();

    // Drain connection pool (async, but we don't wait)
    this.connectionPool.drain().then(() => this.connectionPool.clear()).catch(() => {});

    this.completedTasks.clear();
    this.failedTasks.clear();
    this.totalTasks = 0;
    this.processedCount = 0;
  }
}
