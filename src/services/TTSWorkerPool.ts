// TTSWorkerPool - Queue-based worker pool for concurrent TTS processing
// Replaces legacy polling approach with Promise-based queue

import { EdgeTTSService, TTSWorkerOptions } from './EdgeTTSService';
import type { TTSConfig as VoiceConfig, StatusUpdate } from '../state/types';
import { defaultConfig, getTTSRetryDelay, getWorkerStartDelay, type TTSConfig } from '@/config';

export interface PoolTask {
  partIndex: number;
  text: string;
  filename: string;
  filenum: string;
  voice?: string; // Per-task voice override (fullValue format, e.g., "ru-RU, DmitryNeural")
}

export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  ttsConfig?: TTSConfig; // Optional: override TTS timing config
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
  private voiceConfig: VoiceConfig;
  private ttsConfig: TTSConfig;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onTaskComplete?: (partIndex: number, audioData: Uint8Array) => void;
  private onTaskError?: (partIndex: number, error: Error) => void;
  private onAllComplete?: () => void;

  constructor(options: WorkerPoolOptions) {
    this.maxWorkers = options.maxWorkers;
    this.voiceConfig = options.config;
    this.ttsConfig = options.ttsConfig ?? defaultConfig.tts;
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

    const startDelay = getWorkerStartDelay(this.ttsConfig);

    while (this.activeWorkers.size < this.maxWorkers && this.queue.length > 0) {
      // Check error cooldown - wait if we had a recent error
      const timeSinceError = Date.now() - this.lastErrorTime;
      if (this.lastErrorTime > 0 && timeSinceError < this.ttsConfig.errorCooldown) {
        const waitTime = this.ttsConfig.errorCooldown - timeSinceError;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const task = this.queue.shift()!;
      this.spawnWorker(task, 0);

      // Wait before starting next worker (if there are more to start)
      if (this.queue.length > 0 && this.activeWorkers.size < this.maxWorkers) {
        await new Promise((resolve) => setTimeout(resolve, startDelay));
      }
    }

    this.isProcessingQueue = false;
  }

  private spawnWorker(task: PoolTask, retryCount: number): void {
    // Use task-specific voice if provided, otherwise use default config voice
    const taskConfig: VoiceConfig = task.voice
      ? { ...this.voiceConfig, voice: `Microsoft Server Speech Text to Speech Voice (${task.voice})` }
      : this.voiceConfig;

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
      // Infinite retry with exponential backoff using injected config
      const delay = getTTSRetryDelay(retryCount, this.ttsConfig);
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
