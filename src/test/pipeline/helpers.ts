// Pipeline Test Helpers
// Utilities for testing pipeline steps

import type { PipelineContext, IPipelineStep, ProgressCallback } from '@/services/pipeline/types';
import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
import type { MergedFile } from '@/services/interfaces';

/**
 * Create a test pipeline context with defaults
 */
export function createTestContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    text: 'Test text content.',
    fileNames: [['test_file', 0]],
    dictionaryRules: [],
    detectedLanguage: 'en',
    ...overrides,
  };
}

/**
 * Create a context with characters already extracted
 */
export function createContextWithCharacters(
  characters: LLMCharacter[],
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return createTestContext({
    characters,
    ...overrides,
  });
}

/**
 * Create a context with voice map
 */
export function createContextWithVoiceMap(
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return createTestContext({
    characters,
    voiceMap,
    ...overrides,
  });
}

/**
 * Create a context with assignments
 */
export function createContextWithAssignments(
  assignments: SpeakerAssignment[],
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return createTestContext({
    assignments,
    ...overrides,
  });
}

/**
 * Create a context with audio map
 */
export function createContextWithAudio(
  audioMap: Map<number, Uint8Array>,
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return createTestContext({
    audioMap,
    ...overrides,
  });
}

/**
 * Create a mock pipeline step for testing
 */
export function createMockStep(
  name: string,
  executeFn?: (context: PipelineContext, signal: AbortSignal) => Promise<PipelineContext>
): IPipelineStep {
  let progressCallback: ProgressCallback | undefined;

  return {
    name,
    async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
      if (executeFn) {
        return executeFn(context, signal);
      }
      return context;
    },
    setProgressCallback(callback: ProgressCallback): void {
      progressCallback = callback;
    },
  };
}

/**
 * Create a mock step that adds characters to context
 */
export function createMockCharacterStep(characters: LLMCharacter[]): IPipelineStep {
  return createMockStep('mock-character', async (context) => ({
    ...context,
    characters,
  }));
}

/**
 * Create a mock step that adds voice map to context
 */
export function createMockVoiceMapStep(voiceMap: Map<string, string>): IPipelineStep {
  return createMockStep('mock-voicemap', async (context) => ({
    ...context,
    voiceMap,
  }));
}

/**
 * Create a mock step that adds assignments to context
 */
export function createMockAssignmentStep(assignments: SpeakerAssignment[]): IPipelineStep {
  return createMockStep('mock-assignment', async (context) => ({
    ...context,
    assignments,
  }));
}

/**
 * Create a mock step that adds audio to context
 */
export function createMockAudioStep(audioMap: Map<number, Uint8Array>): IPipelineStep {
  return createMockStep('mock-audio', async (context) => ({
    ...context,
    audioMap,
    failedTasks: new Set(),
  }));
}

/**
 * Create a mock step that adds merged files to context
 */
export function createMockMergeStep(mergedFiles: MergedFile[]): IPipelineStep {
  return createMockStep('mock-merge', async (context) => ({
    ...context,
    mergedFiles,
  }));
}

/**
 * Create an abort controller for testing cancellation
 */
export function createTestAbortController(): AbortController {
  return new AbortController();
}

/**
 * Create a never-aborting signal for simple tests
 */
export function createNeverAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

/**
 * Collect progress updates during step execution
 */
export async function collectProgress(
  step: IPipelineStep,
  context: PipelineContext,
  signal: AbortSignal = createNeverAbortSignal()
): Promise<{ result: PipelineContext; progress: Array<{ current: number; total: number; message: string }> }> {
  const progress: Array<{ current: number; total: number; message: string }> = [];

  step.setProgressCallback((p) => {
    progress.push({
      current: p.current,
      total: p.total,
      message: p.message,
    });
  });

  const result = await step.execute(context, signal);

  return { result, progress };
}
