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
  saveToDir?: FileSystemDirectoryHandle | null;
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

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000]; // Exponential backoff

export class TTSWorkerPool {
  private queue: PoolTask[] = [];
  private activeWorkers: Map<number, ActiveWorker> = new Map();
  private completedAudio: Map<number, Uint8Array> = new Map();
  private failedTasks: Set<number> = new Set();
  private totalTasks = 0;
  private completedCount = 0;

  private maxWorkers: number;
  private config: TTSConfig;
  private saveToDir: FileSystemDirectoryHandle | null;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, audioData: Uint8Array) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;

  constructor(options: WorkerPoolOptions) {
    this.maxWorkers = options.maxWorkers;
    this.config = options.config;
    this.saveToDir = options.saveToDir ?? null;
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

  private processQueue(): void {
    while (this.activeWorkers.size < this.maxWorkers && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.spawnWorker(task, 0);
    }
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
      saveToDir: null, // Don't save individual files - we'll merge them
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
    const worker = this.activeWorkers.get(partIndex);
    this.activeWorkers.delete(partIndex);

    if (retryCount < MAX_RETRIES && worker) {
      // Retry with exponential backoff
      const delay = RETRY_DELAYS[retryCount] ?? 5000;
      this.onStatusUpdate?.({
        partIndex,
        message: `Part ${String(partIndex + 1).padStart(4, '0')}: Retrying (${retryCount + 1}/${MAX_RETRIES})...`,
        isComplete: false,
      });

      setTimeout(() => {
        this.spawnWorker(worker.task, retryCount + 1);
      }, delay);
    } else {
      // Max retries exceeded - skip this chunk
      this.failedTasks.add(partIndex);
      this.completedCount++;

      this.onStatusUpdate?.({
        partIndex,
        message: `Part ${String(partIndex + 1).padStart(4, '0')}: FAILED - Skipped`,
        isComplete: true,
      });

      this.onTaskError?.(partIndex, error);
      this.checkCompletion();
      this.processQueue();
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
