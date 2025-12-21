// TTSWorkerPool - Worker pool using reusable WebSocket connections
// Uses TTSConnectionPool internally for connection management (including CircuitBreaker)
// Writes audio chunks to disk immediately to prevent OOM

import type { TTSConfig as VoiceConfig, StatusUpdate } from '../state/types';
import { defaultConfig, getRetryDelay, type TTSConfig } from '@/config';
import { TTSConnectionPool } from './TTSConnectionPool';
import { isRetriableError } from '@/errors';
import { generateConnectionId } from '@/utils/uuid';
import type { IWorkerPool, PoolTask, WorkerPoolProgress, ILogger } from './interfaces';

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  ttsConfig?: TTSConfig;
  directoryHandle?: FileSystemDirectoryHandle | null;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskComplete?: (partIndex: number, filename: string) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
  logger?: ILogger;
}

interface QueuedTask extends PoolTask {
  retryCount: number;
}

const TEMP_DIR_NAME = '_temp_work';

/**
 * TTSWorkerPool - Uses reusable WebSocket connections
 *
 * Features:
 * - Uses TTSConnectionPool for connection management (including CircuitBreaker)
 * - Reuses WebSocket connections across multiple requests
 * - Writes audio chunks to disk immediately to prevent OOM
 * - Reduces rate-limiting by avoiding frequent new connections
 */
export class TTSWorkerPool implements IWorkerPool {
  private connectionPool: TTSConnectionPool;
  private queue: QueuedTask[] = [];
  private activeTasks: Map<number, QueuedTask> = new Map();
  private completedAudio: Map<number, string> = new Map();
  private failedTasks: Set<number> = new Set();
  private inFlightParts: Set<number> = new Set();
  private totalTasks = 0;
  private completedCount = 0;
  private isProcessingQueue = false;
  private lastErrorTime = 0;
  private tempDirHandle: FileSystemDirectoryHandle | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private initPromise: Promise<void> | null = null;

  private maxWorkers: number;
  private voiceConfig: VoiceConfig;
  private ttsConfig: TTSConfig;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, filename: string) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;
  private logger?: ILogger;

  constructor(options: WorkerPoolOptions) {
    this.maxWorkers = options.maxWorkers;
    this.voiceConfig = options.config;
    this.ttsConfig = options.ttsConfig ?? defaultConfig.tts;
    this.directoryHandle = options.directoryHandle ?? null;
    this.onStatusUpdate = options.onStatusUpdate;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onAllComplete = options.onAllComplete;
    this.logger = options.logger;

    this.connectionPool = new TTSConnectionPool({
      maxConnections: this.maxWorkers,
      logger: this.logger,
    });

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
      this.tempDirHandle = await this.directoryHandle.getDirectoryHandle(TEMP_DIR_NAME, { create: true });
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
    await this.connectionPool.warmup(this.maxWorkers);
  }

  addTask(task: PoolTask): void {
    this.queue.push({ ...task, retryCount: 0 });
    this.totalTasks++;
    this.processQueue();
  }

  addTasks(tasks: PoolTask[]): void {
    for (const task of tasks) {
      this.queue.push({ ...task, retryCount: 0 });
      this.totalTasks++;
    }
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    // Wait for temp directory initialization
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }

    while (this.inFlightParts.size < this.maxWorkers && this.queue.length > 0) {
      // Check circuit breaker status (handled by TTSConnectionPool)
      const poolStats = this.connectionPool.getStats();
      if (poolStats.circuitState === 'OPEN') {
        const waitTime = Math.min(10000, 5000); // Wait up to 10s before checking again
        this.onStatusUpdate?.({
          partIndex: -1,
          message: `Rate limited (circuit breaker open) - waiting...`,
          isComplete: false,
        });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      // Check error cooldown
      const timeSinceError = Date.now() - this.lastErrorTime;
      if (this.lastErrorTime > 0 && timeSinceError < this.ttsConfig.errorCooldown) {
        const waitTime = this.ttsConfig.errorCooldown - timeSinceError;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const task = this.queue.shift()!;
      this.processTask(task);
    }

    this.isProcessingQueue = false;
  }

  private async processTask(task: QueuedTask): Promise<void> {
    this.activeTasks.set(task.partIndex, task);
    if (task.retryCount === 0) {
      this.inFlightParts.add(task.partIndex);
    }

    this.onStatusUpdate?.({
      partIndex: task.partIndex,
      message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Processing...`,
      isComplete: false,
    });

    // Build config with task-specific voice
    const taskConfig: VoiceConfig = task.voice
      ? { ...this.voiceConfig, voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})` }
      : this.voiceConfig;

    try {
      const audioData = await this.connectionPool.execute({
        text: task.text,
        config: taskConfig,
        requestId: generateConnectionId(),
      });

      // Write to disk immediately
      const filename = await this.writeChunkToDisk(task.partIndex, audioData);
      this.handleTaskComplete(task.partIndex, filename);
    } catch (error) {
      this.handleTaskError(task.partIndex, error as Error, task.retryCount);
    }
  }

  private handleTaskComplete(partIndex: number, filename: string): void {
    this.activeTasks.delete(partIndex);
    this.inFlightParts.delete(partIndex);
    this.completedAudio.set(partIndex, filename);
    this.completedCount++;

    this.onStatusUpdate?.({
      partIndex,
      message: `Part ${String(partIndex + 1).padStart(4, '0')}: Complete`,
      isComplete: true,
    });

    this.onTaskComplete?.(partIndex, filename);
    this.checkCompletion();
    this.processQueue();
  }

  private handleTaskError(partIndex: number, error: Error, retryCount: number): void {
    this.lastErrorTime = Date.now();

    const task = this.activeTasks.get(partIndex);
    this.activeTasks.delete(partIndex);

    if (task) {
      // Retriable errors trigger automatic retry with exponential backoff
      if (isRetriableError(error)) {
        const delay = getRetryDelay(retryCount);
        const delaySec = Math.round(delay / 1000);

        this.onStatusUpdate?.({
          partIndex,
          message: `Part ${String(partIndex + 1).padStart(4, '0')}: Error, retrying in ${delaySec}s...`,
          isComplete: false,
        });

        setTimeout(() => {
          this.queue.push({ ...task, retryCount: retryCount + 1 });
          this.processQueue();
        }, delay);
      } else {
        // Non-retriable error - still retry but log warning
        const delay = getRetryDelay(retryCount);
        const delaySec = Math.round(delay / 1000);

        this.logger?.warn(`Task ${partIndex} failed with non-retriable error: ${error.message}`);

        this.onStatusUpdate?.({
          partIndex,
          message: `Part ${String(partIndex + 1).padStart(4, '0')}: Error, retrying in ${delaySec}s...`,
          isComplete: false,
        });

        setTimeout(() => {
          this.queue.push({ ...task, retryCount: retryCount + 1 });
          this.processQueue();
        }, delay);
      }
    }
  }

  private checkCompletion(): void {
    if (
      this.completedCount >= this.totalTasks &&
      this.queue.length === 0 &&
      this.activeTasks.size === 0
    ) {
      this.onAllComplete?.();
    }
  }

  getCompletedAudio(): Map<number, string> {
    return new Map(this.completedAudio);
  }

  getFailedTasks(): Set<number> {
    return new Set(this.failedTasks);
  }

  getProgress(): WorkerPoolProgress {
    return {
      completed: this.completedCount,
      total: this.totalTasks,
      failed: this.failedTasks.size,
    };
  }

  getTempDirHandle(): FileSystemDirectoryHandle | null {
    return this.tempDirHandle;
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): { total: number; ready: number; busy: number; disconnected: number } {
    return this.connectionPool.getStats();
  }

  /**
   * Cleanup temp directory and remove all temp files
   */
  async cleanup(): Promise<void> {
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
    this.connectionPool.shutdown();
    this.queue = [];
    this.activeTasks.clear();
    this.completedAudio.clear();
    this.failedTasks.clear();
    this.inFlightParts.clear();
    this.totalTasks = 0;
    this.completedCount = 0;
  }
}
