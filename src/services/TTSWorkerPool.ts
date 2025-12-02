// TTSWorkerPool - Queue-based worker pool for concurrent TTS processing
// Replaces legacy polling approach with Promise-based queue

import { EdgeTTSService, TTSWorkerOptions } from './EdgeTTSService';
import type { TTSConfig, StatusUpdate } from '../state/types';

export interface PoolTask {
  partIndex: number;
  text: string;
  filename: string;
  filenum: string;
  voice?: string; // Per-task voice override (fullValue format, e.g., "ru-RU, DmitryNeural")
}

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: TTSConfig;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskComplete?: (partIndex: number, audioData: Uint8Array) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
}

interface ActiveWorker {
  service: EdgeTTSService;
  task: PoolTask;
  retryCount: number;
}

const INITIAL_DELAY = 10000; // 10 seconds
const SECOND_DELAY = 30000; // 30 seconds
const DELAY_MULTIPLIER = 3;
const MAX_DELAY = 600000; // 10 minutes
const THREADS_PER_MINUTE = 60; // 1 thread per second
const START_DELAY = 60000 / THREADS_PER_MINUTE; // 1000ms
const ERROR_COOLDOWN = 10000; // 10 seconds - no new threads after any error

function getRetryDelay(retryCount: number): number {
  if (retryCount === 0) return INITIAL_DELAY; // 10s
  if (retryCount === 1) return SECOND_DELAY; // 30s
  // For retry 2+: 30s * 3^(retryCount-1), capped at 10 min
  const delay = SECOND_DELAY * Math.pow(DELAY_MULTIPLIER, retryCount - 1);
  return Math.min(delay, MAX_DELAY);
}

export class TTSWorkerPool {
  private queue: PoolTask[] = [];
  private activeWorkers: Map<number, ActiveWorker> = new Map();
  private completedAudio: Map<number, Uint8Array> = new Map();
  private failedTasks: Set<number> = new Set();
  private totalTasks = 0;
  private completedCount = 0;
  private isProcessingQueue = false;
  private lastErrorTime = 0;

  private maxWorkers: number;
  private config: TTSConfig;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, audioData: Uint8Array) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;

  constructor(options: WorkerPoolOptions) {
    this.maxWorkers = options.maxWorkers;
    this.config = options.config;
    this.onStatusUpdate = options.onStatusUpdate;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskError = options.onTaskError;
    this.onAllComplete = options.onAllComplete;
  }

  addTask(task: PoolTask): void {
    this.queue.push(task);
    this.totalTasks++;
    this.processQueue();
  }

  addTasks(tasks: PoolTask[]): void {
    for (const task of tasks) {
      this.queue.push(task);
      this.totalTasks++;
    }
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    // Prevent multiple concurrent queue processing loops
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.activeWorkers.size < this.maxWorkers && this.queue.length > 0) {
      // Check error cooldown - wait if we had a recent error
      const timeSinceError = Date.now() - this.lastErrorTime;
      if (this.lastErrorTime > 0 && timeSinceError < ERROR_COOLDOWN) {
        const waitTime = ERROR_COOLDOWN - timeSinceError;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const task = this.queue.shift()!;
      this.spawnWorker(task, 0);

      // Wait before starting next worker (if there are more to start)
      if (this.queue.length > 0 && this.activeWorkers.size < this.maxWorkers) {
        await new Promise((resolve) => setTimeout(resolve, START_DELAY));
      }
    }

    this.isProcessingQueue = false;
  }

  private spawnWorker(task: PoolTask, retryCount: number): void {
    // Use task-specific voice if provided, otherwise use default config voice
    const taskConfig: TTSConfig = task.voice
      ? { ...this.config, voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})` }
      : this.config;

    const workerOptions: TTSWorkerOptions = {
      indexPart: task.partIndex,
      filename: task.filename,
      filenum: task.filenum,
      config: taskConfig,
      text: task.text,
      onStatusUpdate: (update) => {
        this.onStatusUpdate?.(update);
      },
      onComplete: (audioData) => {
        this.handleWorkerComplete(task.partIndex, audioData);
      },
      onError: (error) => {
        this.handleWorkerError(task.partIndex, error, retryCount);
      },
    };

    const service = new EdgeTTSService(workerOptions);
    this.activeWorkers.set(task.partIndex, { service, task, retryCount });
    service.start();
  }

  private handleWorkerComplete(partIndex: number, audioData: Uint8Array): void {
    this.activeWorkers.delete(partIndex);
    this.completedAudio.set(partIndex, audioData);
    this.completedCount++;

    this.onTaskComplete?.(partIndex, audioData);
    this.checkCompletion();
    this.processQueue();
  }

  private handleWorkerError(partIndex: number, error: Error, retryCount: number): void {
    this.lastErrorTime = Date.now(); // Record error for cooldown
    const worker = this.activeWorkers.get(partIndex);
    this.activeWorkers.delete(partIndex);

    if (worker) {
      // Infinite retry with exponential backoff (10s, 30s, x3 until 10min max)
      const delay = getRetryDelay(retryCount);
      const delaySec = Math.round(delay / 1000);
      this.onStatusUpdate?.({
        partIndex,
        message: `Part ${String(partIndex + 1).padStart(4, '0')}: Error, retrying in ${delaySec}s...`,
        isComplete: false,
      });

      setTimeout(() => {
        this.spawnWorker(worker.task, retryCount + 1);
      }, delay);
    }
  }

  private checkCompletion(): void {
    if (this.completedCount >= this.totalTasks && this.queue.length === 0 && this.activeWorkers.size === 0) {
      this.onAllComplete?.();
    }
  }

  getCompletedAudio(): Map<number, Uint8Array> {
    return new Map(this.completedAudio);
  }

  getFailedTasks(): Set<number> {
    return new Set(this.failedTasks);
  }

  getProgress(): { completed: number; total: number; failed: number } {
    return {
      completed: this.completedCount,
      total: this.totalTasks,
      failed: this.failedTasks.size,
    };
  }

  clear(): void {
    this.queue = [];
    this.activeWorkers.clear();
    this.completedAudio.clear();
    this.failedTasks.clear();
    this.totalTasks = 0;
    this.completedCount = 0;
  }
}
