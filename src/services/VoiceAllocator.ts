/**
 * VoiceAllocator - Unified voice assignment and allocation logic
 * Consolidates logic from VoiceAssigner, VoiceRemappingStep, and VoiceProfile
 */

import type { LLMCharacter, SpeakerAssignment, VoiceOption, VoicePool } from '@/state/types';
import type { DetectedLanguage } from '@/utils/languageDetection';
import { countSpeakingFrequency } from './llm/CharacterUtils';
import { deduplicateVariants } from './VoicePoolBuilder';

/**
 * Voice allocation result
 */
export interface VoiceAllocation {
  /** Map of character name -> voice ID */
  voiceMap: Map<string, string>;
  /** Voices reserved for rare/unassigned speakers */
  rareVoices: { male: string; female: string; unknown: string };
  /** Number of unique voices assigned */
  uniqueCount: number;
}

/**
 * Voice allocation options
 */
export interface VoiceAllocationOptions {
  /** Narrator voice (reserved, never assigned to characters) */
  narratorVoice: string;
  /** Available voice pool */
  pool: VoicePool;
  /** Pre-reserved voices (e.g., from user selection) */
  reservedVoices?: Set<string>;
}

/**
 * Build a priority-ordered, deduplicated voice pool.
 * Used by all voice assignment paths (initial, randomize, JSON import).
 *
 * Order: native non-Multilingual → native Multilingual → foreign Multilingual
 * Dedup: variant pairs resolved (only one of Andrew/AndrewMultilingual survives)
 */
export function buildPriorityPool(
  voices: VoiceOption[],
  bookLanguage: string,
  reserved: Set<string>,
): { male: VoiceOption[]; female: VoiceOption[] } {
  const available = voices.filter((v) => !reserved.has(v.fullValue));
  const deduped = deduplicateVariants(available, bookLanguage);
  return {
    male: deduped.filter((v) => v.gender === 'male'),
    female: deduped.filter((v) => v.gender === 'female'),
  };
}

/**
 * Tracks used voices during allocation
 */
export class VoicePoolTracker {
  private used: Set<string> = new Set();
  private pool: VoicePool;
  public narratorVoice: string;
  private cycleCounters = { male: 0, female: 0 };

  constructor(pool: VoicePool, narratorVoice: string, reserved: Set<string> = new Set()) {
    this.pool = pool;
    this.narratorVoice = narratorVoice;
    this.used.add(narratorVoice);
    for (const v of reserved) {
      this.used.add(v);
    }
  }

  /**
   * Pick an unused voice for the given gender
   * Reuses voices if pool exhausted
   */
  pickVoice(gender: 'male' | 'female' | 'unknown'): string {
    let pool: string[];

    if (gender === 'male') {
      pool = this.pool.male;
    } else if (gender === 'female') {
      pool = this.pool.female;
    } else {
      // For unknown, balance between pools
      const maleUsed = this.countUsedIn(this.pool.male);
      const femaleUsed = this.countUsedIn(this.pool.female);
      pool = maleUsed <= femaleUsed ? this.pool.male : this.pool.female;
    }

    // Find unused voice
    const available = pool.filter((v) => !this.used.has(v));
    if (available.length > 0) {
      const voice = available[0];
      this.used.add(voice);
      return voice;
    }

    // Fallback: cycle through pool (reuse)
    const genderKey = gender === 'female' ? 'female' : 'male';
    const voice = pool[this.cycleCounters[genderKey] % pool.length];
    this.cycleCounters[genderKey]++;
    return voice;
  }

  /**
   * Reserve a specific voice (won't be picked by pickVoice)
   */
  reserve(voice: string): void {
    this.used.add(voice);
  }

  /**
   * Check if a voice is already used
   */
  isUsed(voice: string): boolean {
    return this.used.has(voice);
  }

  /**
   * Get all currently used voices
   */
  getUsed(): Set<string> {
    return new Set(this.used);
  }

  private countUsedIn(pool: string[]): number {
    return pool.filter((v) => this.used.has(v)).length;
  }
}

/**
 * Simple gender-based voice assignment (no frequency analysis)
 * Used for initial assignment before speaker assignment
 */
export function allocateByGender(
  characters: LLMCharacter[],
  options: VoiceAllocationOptions,
): VoiceAllocation {
  const tracker = new VoicePoolTracker(options.pool, options.narratorVoice, options.reservedVoices);
  const voiceMap = new Map<string, string>();

  // Assign voices to each character
  for (const char of characters) {
    const voice = tracker.pickVoice(char.gender);
    voiceMap.set(char.canonicalName, voice);

    // Map all variations to same voice
    for (const variation of char.variations) {
      if (variation !== char.canonicalName) {
        voiceMap.set(variation, voice);
      }
    }
  }

  // Add rare speaker mappings (use new voices)
  const rareVoices = {
    male: tracker.pickVoice('male'),
    female: tracker.pickVoice('female'),
    unknown: tracker.pickVoice('unknown'),
  };

  voiceMap.set('MALE_UNNAMED', rareVoices.male);
  voiceMap.set('FEMALE_UNNAMED', rareVoices.female);
  voiceMap.set('UNKNOWN_UNNAMED', rareVoices.unknown);

  return {
    voiceMap,
    rareVoices,
    uniqueCount: tracker.getUsed().size - 1, // Exclude narrator
  };
}

/**
 * Frequency-based voice allocation
 * Top N characters get unique voices, remaining share rare voices
 * Used after speaker assignment when we have frequency data
 */
export function allocateByFrequency(
  characters: LLMCharacter[],
  assignments: SpeakerAssignment[],
  options: VoiceAllocationOptions,
): VoiceAllocation {
  const tracker = new VoicePoolTracker(options.pool, options.narratorVoice, options.reservedVoices);
  const voiceMap = new Map<string, string>();

  // Count speaking frequency
  const frequency = countSpeakingFrequency(assignments);

  // Calculate slots: total pool - narrator - 3 rare voices
  const poolSize = options.pool.male.length + options.pool.female.length;
  const uniqueSlots = Math.max(0, poolSize - 1 - 3);

  // Sort by frequency (descending)
  const sorted = [...characters].sort((a, b) => {
    const freqA = frequency.get(a.canonicalName) ?? 0;
    const freqB = frequency.get(b.canonicalName) ?? 0;
    return freqB - freqA;
  });

  // Top N get unique voices
  for (let i = 0; i < Math.min(sorted.length, uniqueSlots); i++) {
    const char = sorted[i];
    const voice = tracker.pickVoice(char.gender);
    voiceMap.set(char.canonicalName, voice);

    for (const variation of char.variations) {
      voiceMap.set(variation, voice);
    }
  }

  // Rest share rare voices
  const rareVoices = {
    male: tracker.pickVoice('male'),
    female: tracker.pickVoice('female'),
    unknown: tracker.pickVoice('unknown'),
  };

  for (let i = uniqueSlots; i < sorted.length; i++) {
    const char = sorted[i];
    const voice = rareVoices[char.gender] ?? rareVoices.unknown;
    voiceMap.set(char.canonicalName, voice);

    for (const variation of char.variations) {
      voiceMap.set(variation, voice);
    }
  }

  voiceMap.set('MALE_UNNAMED', rareVoices.male);
  voiceMap.set('FEMALE_UNNAMED', rareVoices.female);
  voiceMap.set('UNKNOWN_UNNAMED', rareVoices.unknown);

  return {
    voiceMap,
    rareVoices,
    uniqueCount: tracker.getUsed().size - 1,
  };
}

/**
 * Tiered allocation for profile characters
 * Top N get unique voices, rest cycle through all voices
 */
export function allocateTiered(
  characters: Array<{ canonicalName: string; voice: string; lines: number }>,
  availableVoices: VoiceOption[],
  narratorVoice: string,
): Map<string, string> {
  const result = new Map<string, string>();

  // Filter out narrator, sort by lines
  const sorted = characters
    .filter((c) => c.voice !== narratorVoice)
    .sort((a, b) => b.lines - a.lines);

  const voices = availableVoices.map((v) => v.fullValue);

  // Top N get unique voices
  for (let i = 0; i < Math.min(voices.length, sorted.length); i++) {
    result.set(sorted[i].canonicalName, voices[i]);
  }

  // Rest cycle through voices
  for (let i = voices.length; i < sorted.length; i++) {
    result.set(sorted[i].canonicalName, voices[i % voices.length]);
  }

  return result;
}

/**
 * Randomize allocations for characters below a given index
 * Used for UI "randomize below" feature
 */
export function randomizeBelow(
  sortedCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  clickedIndex: number,
  enabledVoices: VoiceOption[],
  narratorVoice: string,
  bookLanguage: DetectedLanguage,
): Map<string, string> {
  const newMap = new Map(currentVoiceMap);

  if (clickedIndex >= sortedCharacters.length - 1) {
    return newMap;
  }

  // Collect reserved voices
  const reserved = new Set<string>([narratorVoice]);
  for (let i = 0; i <= clickedIndex; i++) {
    const voice = currentVoiceMap.get(sortedCharacters[i].canonicalName);
    if (voice) reserved.add(voice);
  }

  // Build priority pool with deduplication
  const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);
  const malePool = pool.male;
  const femalePool = pool.female;

  let maleIdx = 0;
  let femaleIdx = 0;

  for (let i = clickedIndex + 1; i < sortedCharacters.length; i++) {
    const char = sortedCharacters[i];
    const pool =
      char.gender === 'female' && femalePool.length > 0
        ? femalePool
        : malePool.length > 0
          ? malePool
          : femalePool;

    const idx = char.gender === 'female' && femalePool.length > 0 ? femaleIdx++ : maleIdx++;

    if (pool.length > 0) {
      newMap.set(char.canonicalName, pool[idx % pool.length].fullValue);
    }
  }

  return newMap;
}

/**
 * Sort voices by priority: book language voices first, then alphabetically
 */
export function sortVoicesByPriority(
  voices: VoiceOption[],
  bookLanguage: DetectedLanguage,
  narratorVoice: string,
): VoiceOption[] {
  const filtered = voices.filter((v) => v.fullValue !== narratorVoice);
  const langPrefix = bookLanguage === 'ru' ? 'ru' : 'en';

  const bookLang: VoiceOption[] = [];
  const other: VoiceOption[] = [];

  for (const v of filtered) {
    if (v.locale.startsWith(langPrefix)) {
      bookLang.push(v);
    } else {
      other.push(v);
    }
  }

  bookLang.sort((a, b) => a.fullValue.localeCompare(b.fullValue));
  other.sort((a, b) => a.fullValue.localeCompare(b.fullValue));

  return [...bookLang, ...other];
}

/**
 * Remap voiceId in speaker assignments
 */
export function remapAssignments(
  assignments: SpeakerAssignment[],
  voiceMap: Map<string, string>,
  narratorVoice: string,
): SpeakerAssignment[] {
  return assignments.map((a) => ({
    ...a,
    voiceId: a.speaker === 'narrator' ? narratorVoice : (voiceMap.get(a.speaker) ?? narratorVoice),
  }));
}

/**
 * Format voice ID for display (shorten long format)
 */
export function shortVoiceId(voice: string): string {
  // "ru-RU, DmitryNeural" -> "ru-RU-DmitryNeural"
  if (voice.includes(', ') && !voice.includes('(')) {
    return voice.replace(', ', '-');
  }

  // "Microsoft Server Speech... (ru-RU, DmitryNeural)" -> "ru-RU-DmitryNeural"
  const match = voice.match(/\(([^,]+),\s*([^)]+)\)/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return voice;
}
