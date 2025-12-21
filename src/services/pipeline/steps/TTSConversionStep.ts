// TTS Conversion Step
// Converts text to audio using TTS worker pool
// Audio chunks are written to disk immediately to prevent OOM

import { BasePipelineStep, PipelineContext } from '../types';
import type { IWorkerPool, WorkerPoolOptions, PoolTask } from '@/services/interfaces';
import type { TTSConfig, SpeakerAssignment } from '@/state/types';

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
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['text', 'dictionaryRules', 'assignments', 'characters'];

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
            this.reportProgress(audioMap.size, chunks.length, update.message);
          },
          onTaskComplete: (partIndex, filename) => {
            audioMap.set(partIndex, filename);
            this.reportProgress(audioMap.size, chunks.length, `Written ${audioMap.size}/${chunks.length} files`);
          },
          onTaskError: (partIndex, error) => {
            failedTasks.add(partIndex);
            this.reportProgress(audioMap.size, chunks.length, `Part ${partIndex + 1} failed: ${error.message}`);
          },
          onAllComplete: () => {
            resolve();
          },
        });

        // Build tasks
        const tasks: PoolTask[] = chunks.map((chunk) => {
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
      const tempDirHandle = this.workerPool!.getTempDirHandle();
      if (!tempDirHandle) {
        throw new Error('Temp directory handle not available after TTS conversion');
      }

      return {
        ...context,
        audioMap,
        tempDirHandle,
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
