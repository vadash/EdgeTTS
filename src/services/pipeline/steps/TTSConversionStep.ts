// TTS Conversion Step
// Converts text to audio using TTS worker pool

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
 * Takes speaker assignments and produces audio chunks
 */
export class TTSConversionStep extends BasePipelineStep {
  readonly name = 'tts-conversion';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['assignments'];

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

    const audioMap = new Map<number, Uint8Array>();
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

        // Create worker pool
        this.workerPool = this.options.createWorkerPool({
          maxWorkers: this.options.maxWorkers,
          config: this.options.ttsConfig,
          onStatusUpdate: (update) => {
            this.reportProgress(audioMap.size, chunks.length, update.message);
          },
          onTaskComplete: (partIndex, audioData) => {
            audioMap.set(partIndex, audioData);
            this.reportProgress(audioMap.size, chunks.length, `Completed ${audioMap.size}/${chunks.length}`);
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
    } finally {
      signal.removeEventListener('abort', abortHandler);
      this.workerPool = null;
    }

    return {
      ...context,
      audioMap,
      failedTasks,
    };
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
