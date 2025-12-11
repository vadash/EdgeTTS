// Voice Remapping Step
// Remaps voices based on speaking frequency after speaker assignment

import { BasePipelineStep, PipelineContext } from '../types';
import type { VoicePool, LLMCharacter, SpeakerAssignment } from '@/state/types';
import { countSpeakingFrequency } from '@/services/llm/CharacterUtils';

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

    // 1. Count speaking frequency
    const frequency = countSpeakingFrequency(assignments);

    // 2. Calculate available unique slots
    const poolSize = this.options.pool.male.length + this.options.pool.female.length;
    const uniqueSlots = Math.max(0, poolSize - 1 - 3); // -1 narrator, -3 rare (m/f/u)

    // 3. Sort characters by frequency (descending)
    const sortedCharacters = [...characters].sort((a, b) => {
      const freqA = frequency.get(a.canonicalName) ?? 0;
      const freqB = frequency.get(b.canonicalName) ?? 0;
      return freqB - freqA;
    });

    // 4. Assign voices based on frequency
    const { newVoiceMap, rareVoices } = this.assignVoicesByFrequency(
      sortedCharacters,
      frequency,
      uniqueSlots
    );

    // 5. Remap voiceId in all assignments
    const remappedAssignments = this.remapAssignments(assignments, newVoiceMap);

    // 6. Log summary table
    const narratorLines = assignments.filter(a => a.speaker === 'narrator').length;
    this.logVoiceAssignmentTable(sortedCharacters, frequency, newVoiceMap, uniqueSlots, poolSize, rareVoices, narratorLines);

    this.reportProgress(1, 1, `Remapped ${characters.length} character(s) to ${new Set(newVoiceMap.values()).size} voice(s)`);

    return {
      ...context,
      voiceMap: newVoiceMap,
      assignments: remappedAssignments,
    };
  }

  /**
   * Assign voices based on frequency ranking
   */
  private assignVoicesByFrequency(
    sortedCharacters: LLMCharacter[],
    frequency: Map<string, number>,
    uniqueSlots: number
  ): { newVoiceMap: Map<string, string>; rareVoices: Record<string, string> } {
    const newVoiceMap = new Map<string, string>();
    const usedVoices = new Set<string>();

    // Reserve narrator voice
    usedVoices.add(this.options.narratorVoice);

    // Helper to pick voice from pool
    const pickVoice = (gender: 'male' | 'female' | 'unknown'): string => {
      let pool: string[];
      if (gender === 'male') {
        pool = this.options.pool.male;
      } else if (gender === 'female') {
        pool = this.options.pool.female;
      } else {
        // For unknown, alternate between pools
        const maleUsed = [...usedVoices].filter(v => this.options.pool.male.includes(v)).length;
        const femaleUsed = [...usedVoices].filter(v => this.options.pool.female.includes(v)).length;
        pool = maleUsed <= femaleUsed ? this.options.pool.male : this.options.pool.female;
      }

      // Find unused voice
      const available = pool.filter(v => !usedVoices.has(v));
      if (available.length > 0) {
        const voice = available[Math.floor(Math.random() * available.length)];
        usedVoices.add(voice);
        return voice;
      }

      // Fallback to random from pool
      return pool[Math.floor(Math.random() * pool.length)];
    };

    // Assign unique voices to top N characters
    for (let i = 0; i < Math.min(sortedCharacters.length, uniqueSlots); i++) {
      const char = sortedCharacters[i];
      const voice = pickVoice(char.gender);
      newVoiceMap.set(char.canonicalName, voice);

      // Map all variations to same voice
      for (const variation of char.variations) {
        newVoiceMap.set(variation, voice);
      }
    }

    // Assign shared voices for rare speakers (one per gender)
    const rareVoices = {
      male: pickVoice('male'),
      female: pickVoice('female'),
      unknown: pickVoice('unknown'),
    };

    // Assign remaining characters to rare voices
    for (let i = uniqueSlots; i < sortedCharacters.length; i++) {
      const char = sortedCharacters[i];
      const voice = rareVoices[char.gender];
      newVoiceMap.set(char.canonicalName, voice);

      for (const variation of char.variations) {
        newVoiceMap.set(variation, voice);
      }
    }

    // Add unnamed speaker mappings
    newVoiceMap.set('MALE_UNNAMED', rareVoices.male);
    newVoiceMap.set('FEMALE_UNNAMED', rareVoices.female);
    newVoiceMap.set('UNKNOWN_UNNAMED', rareVoices.unknown);

    return { newVoiceMap, rareVoices };
  }

  /**
   * Remap voiceId in all speaker assignments
   */
  private remapAssignments(
    assignments: SpeakerAssignment[],
    voiceMap: Map<string, string>
  ): SpeakerAssignment[] {
    return assignments.map(a => ({
      ...a,
      voiceId: a.speaker === 'narrator'
        ? this.options.narratorVoice
        : voiceMap.get(a.speaker) ?? this.options.narratorVoice,
    }));
  }

  /**
   * Log voice assignment summary table
   */
  private logVoiceAssignmentTable(
    sortedCharacters: LLMCharacter[],
    frequency: Map<string, number>,
    voiceMap: Map<string, string>,
    uniqueSlots: number,
    poolSize: number,
    rareVoices: Record<string, string>,
    narratorLines: number
  ): void {
    this.reportProgress(0, 0, '');
    this.reportProgress(0, 0, '══════ Voice Assignment ══════');
    this.reportProgress(0, 0, `Pool: ${poolSize} | Unique: ${uniqueSlots} | Rare: 3`);
    this.reportProgress(0, 0, '');

    // Narrator row with line count
    const narratorLinesStr = String(narratorLines).padStart(3);
    this.reportProgress(0, 0, `  N  NARRATOR              ${narratorLinesStr}  ${this.shortVoice(this.options.narratorVoice)}`);
    this.reportProgress(0, 0, '  ─────────────────────────────');

    // Character rows
    for (let i = 0; i < sortedCharacters.length; i++) {
      const char = sortedCharacters[i];
      const lines = frequency.get(char.canonicalName) ?? 0;
      const voice = voiceMap.get(char.canonicalName) ?? '?';
      const isRare = i >= uniqueSlots;

      // Add separator when transitioning from unique to rare
      if (isRare && i === uniqueSlots && uniqueSlots > 0) {
        this.reportProgress(0, 0, '  ─────────────────────────────');
      }

      const rank = String(i + 1).padStart(2);
      const name = char.canonicalName.slice(0, 16).padEnd(16);
      const genderChar = char.gender === 'male' ? 'M' : char.gender === 'female' ? 'F' : '?';
      const linesStr = String(lines).padStart(3);
      const marker = isRare ? '*' : ' ';

      this.reportProgress(0, 0, `${marker}${rank}. ${name} ${genderChar} ${linesStr}  ${this.shortVoice(voice)}`);
    }

    // Rare voices section (if any rare speakers exist)
    if (sortedCharacters.length > uniqueSlots || sortedCharacters.length === 0) {
      this.reportProgress(0, 0, '  ─────────────────────────────');
      this.reportProgress(0, 0, '  *  RARE_MALE         M      ' + this.shortVoice(rareVoices.male));
      this.reportProgress(0, 0, '  *  RARE_FEMALE       F      ' + this.shortVoice(rareVoices.female));
      this.reportProgress(0, 0, '  *  RARE_UNKNOWN      ?      ' + this.shortVoice(rareVoices.unknown));
    }

    this.reportProgress(0, 0, '══════════════════════════════');
    this.reportProgress(0, 0, '');
  }

  /**
   * Shorten voice name for display
   * Handles formats: "locale, VoiceName" or "Microsoft Server Speech... (locale, VoiceName)"
   */
  private shortVoice(voice: string): string {
    // Format 1: "ru-RU, DmitryNeural" -> "ru-RU-DmitryNeural"
    if (voice.includes(', ') && !voice.includes('(')) {
      return voice.replace(', ', '-');
    }

    // Format 2: "Microsoft Server Speech Text to Speech Voice (ru-RU, DmitryNeural)" -> "ru-RU-DmitryNeural"
    const match = voice.match(/\(([^,]+),\s*([^)]+)\)/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }

    // Fallback: return as-is
    return voice;
  }
}

/**
 * Create a VoiceRemappingStep
 */
export function createVoiceRemappingStep(
  options: VoiceRemappingStepOptions
): VoiceRemappingStep {
  return new VoiceRemappingStep(options);
}
