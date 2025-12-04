// Pipeline Types
// Defines interfaces for the conversion pipeline architecture

import type { LLMCharacter, SpeakerAssignment, TextBlock } from '@/state/types';
import type { MergedFile } from '@/services/interfaces';

// ============================================================================
// Base Context Types
// ============================================================================

/**
 * Base pipeline context with required input fields
 */
export interface BaseContext {
  text: string;
  fileNames: Array<[string, number]>;
  dictionaryRules: string[];
  detectedLanguage: string;
  directoryHandle?: FileSystemDirectoryHandle | null;
}

/**
 * Context with characters extracted (after CharacterExtractionStep)
 */
export interface ContextWithCharacters extends BaseContext {
  characters: LLMCharacter[];
}

/**
 * Context with voice map (after VoiceAssignmentStep)
 */
export interface ContextWithVoiceMap extends ContextWithCharacters {
  voiceMap: Map<string, string>;
}

/**
 * Context with assignments (after SpeakerAssignmentStep)
 */
export interface ContextWithAssignments extends ContextWithVoiceMap {
  assignments: SpeakerAssignment[];
}

/**
 * Context with audio (after TTSConversionStep)
 */
export interface ContextWithAudio extends ContextWithAssignments {
  audioMap: Map<number, Uint8Array>;
  failedTasks: Set<number>;
}

/**
 * Context with merged files (after AudioMergeStep)
 */
export interface ContextWithMergedFiles extends ContextWithAudio {
  mergedFiles: MergedFile[];
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if context has characters
 */
export function hasCharacters(ctx: PipelineContext): ctx is PipelineContext & { characters: LLMCharacter[] } {
  return Array.isArray(ctx.characters);
}

/**
 * Check if context has voice map
 */
export function hasVoiceMap(ctx: PipelineContext): ctx is PipelineContext & { characters: LLMCharacter[]; voiceMap: Map<string, string> } {
  return Array.isArray(ctx.characters) && ctx.voiceMap instanceof Map;
}

/**
 * Check if context has assignments
 */
export function hasAssignments(ctx: PipelineContext): ctx is PipelineContext & { assignments: SpeakerAssignment[] } {
  return Array.isArray(ctx.assignments);
}

/**
 * Check if context has audio
 */
export function hasAudio(ctx: PipelineContext): ctx is PipelineContext & { audioMap: Map<number, Uint8Array> } {
  return ctx.audioMap instanceof Map;
}

/**
 * Check if context has merged files
 */
export function hasMergedFiles(ctx: PipelineContext): ctx is PipelineContext & { mergedFiles: MergedFile[] } {
  return Array.isArray(ctx.mergedFiles);
}

// ============================================================================
// Full Pipeline Context (union of all stages)
// ============================================================================

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
  protected abstract readonly requiredContextKeys: (keyof PipelineContext)[];
  protected progressCallback?: ProgressCallback;

  abstract execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext>;

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Validate that required context keys are present
   * @throws Error if any required key is missing or empty
   */
  protected validateContext(context: PipelineContext): void {
    for (const key of this.requiredContextKeys) {
      const value = context[key];
      if (value === undefined || value === null) {
        throw new Error(`${this.name} requires '${key}' from previous step`);
      }
      // For arrays, also check empty
      if (Array.isArray(value) && value.length === 0) {
        throw new Error(`${this.name} requires non-empty '${key}'`);
      }
    }
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
