// TTS Conversion Step
// Converts text to audio using TTS worker pool
// Audio chunks are written to disk immediately to prevent OOM

import { BasePipelineStep, PipelineContext } from '../types';
import type { IWorkerPool, WorkerPoolOptions, PoolTask } from '@/services/interfaces';
import type { TTSConfig, SpeakerAssignment } from '@/state/types';
import { getErrorMessage } from '@/errors';

/**
 * Options for TTSConversionStep
 */
export interface TTSConversionStepOptions {
  maxWorkers: number;
  ttsConfig: TTSConfig;
  createWorkerPool: (options: WorkerPoolOptions) => IWorkerPool;
}

/**
 * Converts text to audio using TTS worker pool
 * Takes speaker assignments and produces audio chunks stored on disk
 */
export class TTSConversionStep extends BasePipelineStep {
  readonly name = 'tts-conversion';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['assignments', 'directoryHandle'];
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['text', 'dictionaryRules'];

  private workerPool: IWorkerPool | null = null;

  constructor(private options: TTSConversionStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);
    this.validateContext(context);

    // After validation, these are guaranteed to exist
    const assignments = context.assignments!;
    const fileNames = context.fileNames;
    const directoryHandle = context.directoryHandle!;

    // Filter out empty sentences
    const chunks = assignments
      .filter(a => /[\p{L}\p{N}]/u.test(a.text))
      .map((a, index) => ({
        text: a.text,
        voice: a.voiceId,
        partIndex: index,
        speaker: a.speaker,
      }));

    if (chunks.length === 0) {
      throw new Error('No pronounceable content to convert');
    }

    this.reportProgress(0, chunks.length, `Converting ${chunks.length} chunks to audio...`);

    const audioMap = new Map<number, string>();
    const failedTasks = new Set<number>();

    // Pre-scan for cached chunks in _temp_work
    let tempDirHandle: FileSystemDirectoryHandle | null = null;

    try {
      tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work');
    } catch {
      // No temp dir yet - will be created by worker pool
    }

    if (tempDirHandle) {
      for (const chunk of chunks) {
        const filename = `chunk_${String(chunk.partIndex).padStart(6, '0')}.bin`;
        try {
          const handle = await tempDirHandle.getFileHandle(filename);
          const file = await handle.getFile();
          if (file.size > 0) {
            audioMap.set(chunk.partIndex, filename);
          }
        } catch {
          // File doesn't exist, will be processed
        }
      }

      if (audioMap.size > 0) {
        this.reportProgress(audioMap.size, chunks.length,
          `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`);
      }
    }

    // Filter out cached chunks
    const remainingChunks = chunks.filter(c => !audioMap.has(c.partIndex));

    if (remainingChunks.length === 0) {
      this.reportProgress(chunks.length, chunks.length, 'All chunks cached, skipping TTS');
      if (!tempDirHandle) {
        throw new Error('Temp directory handle not available');
      }
      return {
        ...context,
        audioMap,
        tempDirHandle,
        failedTasks: new Set<number>(),
      };
    }

    // Create abort handler
    const abortHandler = () => {
      this.workerPool?.clear();
    };
    signal.addEventListener('abort', abortHandler);

    try {
      await new Promise<void>((resolve, reject) => {
        // Handle abort signal
        if (signal.aborted) {
          reject(new Error('Pipeline cancelled'));
          return;
        }

        // Create worker pool with directoryHandle for disk-based storage
        this.workerPool = this.options.createWorkerPool({
          maxWorkers: this.options.maxWorkers,
          config: this.options.ttsConfig,
          directoryHandle: directoryHandle,
          onStatusUpdate: (update) => {
            // Only report retry messages (important for user visibility)
            if (update.message.includes('Retry')) {
              this.reportProgress(audioMap.size, chunks.length, update.message);
            }
          },
          onTaskComplete: (partIndex, filename) => {
            audioMap.set(partIndex, filename);
            const completed = audioMap.size;

            // Calculate interval based on 1% of total
            const percentageInterval = Math.max(1, Math.floor(chunks.length * 0.01));
            const minInterval = 50;
            const maxInterval = 500;
            const step = 50;
            // Clamp to min/max range first
            const clampedInterval = Math.max(minInterval, Math.min(percentageInterval, maxInterval));
            // Round to nearest multiple of 50
            const reportInterval = Math.round(clampedInterval / step) * step;
            // Ensure final value stays within bounds (in case rounding pushed it over)
            const finalInterval = Math.max(minInterval, Math.min(reportInterval, maxInterval));
            
            if (completed % finalInterval === 0 || completed === chunks.length) {
              this.reportProgress(completed, chunks.length, `Written ${completed}/${chunks.length} files`);
            }
          },
          onTaskError: (partIndex, error) => {
            failedTasks.add(partIndex);
            this.reportProgress(audioMap.size, chunks.length, `Part ${partIndex + 1} failed: ${getErrorMessage(error)}`);
          },
          onAllComplete: () => {
            resolve();
          },
        });

        // Build tasks
        const tasks: PoolTask[] = remainingChunks.map((chunk) => {
          let filename = fileNames[0]?.[0] ?? 'audio';
          for (const [name, boundaryIndex] of fileNames) {
            if (chunk.partIndex >= boundaryIndex && boundaryIndex > 0) {
              filename = name;
            }
          }

          return {
            partIndex: chunk.partIndex,
            text: chunk.text,
            filename: filename,
            filenum: String(chunk.partIndex + 1).padStart(4, '0'),
            voice: chunk.voice,
          };
        });

        this.workerPool.addTasks(tasks);
      });

      // Get the temp directory handle from worker pool
      const workerTempDirHandle = this.workerPool!.getTempDirHandle();
      if (!workerTempDirHandle) {
        throw new Error('Temp directory handle not available after TTS conversion');
      }

      return {
        ...context,
        audioMap,
        tempDirHandle: workerTempDirHandle,
        failedTasks,
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
      this.workerPool = null;
    }
  }
}

/**
 * Create a TTSConversionStep
 */
export function createTTSConversionStep(
  options: TTSConversionStepOptions
): TTSConversionStep {
  return new TTSConversionStep(options);
}
