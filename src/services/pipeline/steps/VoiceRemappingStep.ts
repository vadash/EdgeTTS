// Voice Remapping Step
// Remaps voices based on speaking frequency after speaker assignment

import { BasePipelineStep, PipelineContext } from '../types';
import type { VoicePool, LLMCharacter, SpeakerAssignment } from '@/state/types';
import { allocateByFrequency, remapAssignments, shortVoiceId } from '@/services/VoiceAllocator';

/**
 * Options for VoiceRemappingStep
 */
export interface VoiceRemappingStepOptions {
  narratorVoice: string;
  pool: VoicePool;
}

/**
 * Remaps voice assignments based on speaking frequency
 * - Major characters (top N by frequency) get unique voices
 * - Rare speakers share 3 generic voices (by gender)
 * - N = poolSize - 1 (narrator) - 3 (rare)
 */
export class VoiceRemappingStep extends BasePipelineStep {
  readonly name = 'voice-remapping';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['assignments', 'characters'];

  constructor(private options: VoiceRemappingStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const assignments = context.assignments!;
    const characters = context.characters!;

    if (characters.length === 0) {
      this.reportProgress(1, 1, 'No characters to remap');
      return context;
    }

    this.reportProgress(0, 1, 'Remapping voices by speaking frequency...');

    // Allocate voices by frequency
    const { voiceMap, rareVoices, uniqueCount } = allocateByFrequency(
      characters,
      assignments,
      this.options
    );

    // Remap assignments
    const remappedAssignments = remapAssignments(assignments, voiceMap, this.options.narratorVoice);

    // Log summary
    this.logSummary(characters, assignments, voiceMap, rareVoices, uniqueCount);

    this.reportProgress(1, 1, `Remapped ${characters.length} character(s) to ${uniqueCount} voice(s)`);

    return {
      ...context,
      voiceMap,
      assignments: remappedAssignments,
    };
  }

  private logSummary(
    characters: LLMCharacter[],
    assignments: SpeakerAssignment[],
    voiceMap: Map<string, string>,
    rareVoices: { male: string; female: string; unknown: string },
    uniqueCount: number
  ): void {
    const frequency = new Map<string, number>();
    for (const a of assignments) {
      if (a.speaker !== 'narrator') {
        frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
      }
    }

    const poolSize = this.options.pool.male.length + this.options.pool.female.length;
    const uniqueSlots = Math.max(0, poolSize - 1 - 3);

    const sorted = [...characters].sort((a, b) => {
      const freqA = frequency.get(a.canonicalName) ?? 0;
      const freqB = frequency.get(b.canonicalName) ?? 0;
      return freqB - freqA;
    });

    this.reportProgress(0, 0, '');
    this.reportProgress(0, 0, '══════ Voice Assignment ══════');
    this.reportProgress(0, 0, `Pool: ${poolSize} | Unique: ${uniqueSlots} | Rare: 3`);
    this.reportProgress(0, 0, '');

    const narratorLines = assignments.filter(a => a.speaker === 'narrator').length;
    this.reportProgress(0, 0, `  N  NARRATOR              ${String(narratorLines).padStart(3)}  ${shortVoiceId(this.options.narratorVoice)}`);
    this.reportProgress(0, 0, '  ─────────────────────────────');

    for (let i = 0; i < sorted.length; i++) {
      const char = sorted[i];
      const lines = frequency.get(char.canonicalName) ?? 0;
      const voice = voiceMap.get(char.canonicalName) ?? '?';
      const isRare = i >= uniqueSlots;

      if (isRare && i === uniqueSlots && uniqueSlots > 0) {
        this.reportProgress(0, 0, '  ─────────────────────────────');
      }

      const genderChar = char.gender === 'male' ? 'M' : char.gender === 'female' ? 'F' : '?';
      const marker = isRare ? '*' : ' ';
      this.reportProgress(0, 0, `${marker}${String(i + 1).padStart(2)}. ${(char.canonicalName.slice(0, 16) + '                ').slice(0, 16)} ${genderChar} ${String(lines).padStart(3)}  ${shortVoiceId(voice)}`);
    }

    if (sorted.length > uniqueSlots || sorted.length === 0) {
      this.reportProgress(0, 0, '  ─────────────────────────────');
      this.reportProgress(0, 0, '  *  RARE_MALE         M      ' + shortVoiceId(rareVoices.male));
      this.reportProgress(0, 0, '  *  RARE_FEMALE       F      ' + shortVoiceId(rareVoices.female));
      this.reportProgress(0, 0, '  *  RARE_UNKNOWN      ?      ' + shortVoiceId(rareVoices.unknown));
    }

    this.reportProgress(0, 0, '══════════════════════════════');
    this.reportProgress(0, 0, '');
  }
}

export function createVoiceRemappingStep(
  options: VoiceRemappingStepOptions
): VoiceRemappingStep {
  return new VoiceRemappingStep(options);
}
