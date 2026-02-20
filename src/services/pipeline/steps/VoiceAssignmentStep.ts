// Voice Assignment Step
// Assigns voices to detected characters based on gender and locale

import { BasePipelineStep, PipelineContext } from '../types';
import type { VoicePool } from '@/services/interfaces';
import type { LLMCharacter } from '@/state/types';
import { allocateByGender } from '@/services/VoiceAllocator';

/**
 * Options for VoiceAssignmentStep
 */
export interface VoiceAssignmentStepOptions {
  narratorVoice: string;
  pool: VoicePool;
}

/**
 * Assigns unique voices to detected characters
 * Uses simple gender-based allocation before speaker assignment
 */
export class VoiceAssignmentStep extends BasePipelineStep {
  readonly name = 'voice-assignment';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];

  constructor(private options: VoiceAssignmentStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const characters = context.characters;
    if (!characters || characters.length === 0) {
      this.reportProgress(1, 1, 'No characters to assign voices to');
      return {
        ...context,
        voiceMap: new Map(),
      };
    }

    this.reportProgress(0, characters.length, 'Assigning voices to characters...');

    // Allocate voices by gender
    const { voiceMap, uniqueCount } = allocateByGender(characters, this.options);

    this.reportProgress(characters.length, characters.length, `Assigned ${uniqueCount} voice(s) to ${characters.length} character(s)`);

    return {
      ...context,
      voiceMap,
    };
  }
}

/**
 * Create a VoiceAssignmentStep
 */
export function createVoiceAssignmentStep(
  options: VoiceAssignmentStepOptions
): VoiceAssignmentStep {
  return new VoiceAssignmentStep(options);
}
