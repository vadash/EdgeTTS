// Voice Assignment Step
// Assigns voices to detected characters based on gender and locale

import { BasePipelineStep, PipelineContext } from '../types';
import type { IVoiceAssigner, VoicePool } from '@/services/interfaces';
import type { LLMCharacter } from '@/state/types';

/**
 * Options for VoiceAssignmentStep
 */
export interface VoiceAssignmentStepOptions {
  narratorVoice: string;
  detectedLanguage: string;
  enabledVoices?: string[];
  createVoiceAssigner: (narratorVoice: string, locale: string, enabledVoices?: string[]) => IVoiceAssigner;
}

/**
 * Assigns unique voices to detected characters
 * Uses VoiceAssigner with locale-filtered voice pools
 */
export class VoiceAssignmentStep extends BasePipelineStep {
  readonly name = 'voice-assignment';

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

    // Create voice assigner with filtered pool
    const assigner = this.options.createVoiceAssigner(
      this.options.narratorVoice,
      context.detectedLanguage || this.options.detectedLanguage,
      this.options.enabledVoices
    );

    // Assign voices
    const voiceMap = assigner.assignVoicesFromLLMCharacters(characters);

    this.reportProgress(characters.length, characters.length, `Assigned ${voiceMap.size} voice(s)`);

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
