// Pipeline Types
// Defines interfaces for the conversion pipeline architecture

import type { LLMCharacter, SpeakerAssignment, TextBlock } from '@/state/types';
import type { MergedFile } from '@/services/interfaces';

/**
 * Pipeline context - data that flows through pipeline steps
 * Each step can read and modify this context
 */
export interface PipelineContext {
  // Input
  text: string;
  fileNames: Array<[string, number]>;
  dictionaryRules: string[];
  detectedLanguage: string;

  // LLM Pass 1 output
  characters?: LLMCharacter[];

  // Voice assignment output
  voiceMap?: Map<string, string>;

  // LLM Pass 2 output
  assignments?: SpeakerAssignment[];

  // TTS output
  audioMap?: Map<number, Uint8Array>;
  failedTasks?: Set<number>;

  // Merge output
  mergedFiles?: MergedFile[];

  // Directory handle for saving
  directoryHandle?: FileSystemDirectoryHandle | null;
}

/**
 * Progress information from a pipeline step
 */
export interface PipelineProgress {
  /** Name of the current step */
  step: string;
  /** Current item being processed */
  current: number;
  /** Total items to process */
  total: number;
  /** Human-readable message */
  message: string;
}

/**
 * Callback for progress updates
 */
export type ProgressCallback = (progress: PipelineProgress) => void;

/**
 * Pipeline step interface
 * Each step transforms the context and passes it to the next step
 */
export interface IPipelineStep {
  /** Unique name for this step */
  readonly name: string;

  /**
   * Execute this pipeline step
   * @param context Current pipeline context
   * @param signal Abort signal for cancellation
   * @returns Modified context (or same context if no changes)
   */
  execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext>;

  /**
   * Set progress callback
   * @param callback Function to call with progress updates
   */
  setProgressCallback(callback: ProgressCallback): void;
}

/**
 * Pipeline runner interface
 * Executes a sequence of steps
 */
export interface IPipelineRunner {
  /**
   * Add a step to the pipeline
   * @param step Step to add
   */
  addStep(step: IPipelineStep): void;

  /**
   * Execute all steps in sequence
   * @param context Initial context
   * @param signal Abort signal for cancellation
   * @returns Final context after all steps
   */
  run(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext>;

  /**
   * Set global progress callback
   * @param callback Function to call with progress updates
   */
  setProgressCallback(callback: ProgressCallback): void;

  /**
   * Get list of step names
   */
  getStepNames(): string[];
}

/**
 * Base class for pipeline steps with common functionality
 */
export abstract class BasePipelineStep implements IPipelineStep {
  abstract readonly name: string;
  protected progressCallback?: ProgressCallback;

  abstract execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext>;

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Report progress
   */
  protected reportProgress(current: number, total: number, message: string): void {
    this.progressCallback?.({
      step: this.name,
      current,
      total,
      message,
    });
  }

  /**
   * Check if cancelled and throw if so
   */
  protected checkCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('Pipeline cancelled');
    }
  }
}
