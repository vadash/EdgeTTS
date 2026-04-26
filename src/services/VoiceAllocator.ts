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
 * Order: native non-Multilingual -> native Multilingual -> foreign Multilingual
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

    // Fallback: if pool is empty, try the other gender
    if (pool.length === 0) {
      const otherPool = gender === 'male' ? this.pool.female : this.pool.male;
      if (otherPool.length > 0) {
        const otherAvailable = otherPool.filter((v) => !this.used.has(v));
        if (otherAvailable.length > 0) {
          const voice = otherAvailable[0];
          this.used.add(voice);
          return voice;
        }
      }
    }

    // Fallback: cycle through pool (reuse)
    const genderKey = gender === 'female' ? 'female' : 'male';
    if (pool.length > 0) {
      const voice = pool[this.cycleCounters[genderKey] % pool.length];
      this.cycleCounters[genderKey]++;
      return voice;
    }

    // Last resort: if no voices available at all, return empty string
    return '';
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
 * Tiered allocation options for frequency-based voice assignment
 */
export interface TieredAllocationOptions {
  /** Characters to assign voices to */
  characters: LLMCharacter[];
  /** Speaking frequency per character (name -> line count) */
  frequency: Map<string, number>;
  /** Voice pool to allocate from */
  pool: VoicePool;
  /** Narrator voice (reserved, never assigned) */
  narratorVoice: string;
  /** Pre-reserved voices (e.g., user-selected) */
  reservedVoices?: Set<string>;
}

/**
 * Tiered voice allocation based on speaking frequency
 *
 * Strategy:
 * 1. Narrator voice is reserved (excluded from pool)
 * 2. Top N speakers (topPercent of pool size) get unique voices
 * 3. Remaining characters cycle through the leftover pool
 * 4. Rare/unnamed speakers get dedicated voices per gender
 *
 * This prevents the "all minor characters share 3 voices" problem while
 * ensuring the most-heard characters are distinguishable.
 */
export function allocateTieredVoices(options: TieredAllocationOptions): VoiceAllocation {
  const { characters, frequency, pool, narratorVoice, reservedVoices = new Set() } = options;

  const tracker = new VoicePoolTracker(pool, narratorVoice, reservedVoices);
  const voiceMap = new Map<string, string>();

  // Sort by frequency (descending)
  const sorted = [...characters].sort((a, b) => {
    const freqA = frequency.get(a.canonicalName) ?? 0;
    const freqB = frequency.get(b.canonicalName) ?? 0;
    return freqB - freqA;
  });

  // Assign voices to all characters (top speakers naturally get unique voices first)
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted[i];
    const voice = tracker.pickVoice(char.gender);
    voiceMap.set(char.canonicalName, voice);

    // Map all variations to same voice
    for (const variation of char.variations) {
      if (variation !== char.canonicalName) {
        voiceMap.set(variation, voice);
      }
    }
  }

  // Assign rare speaker voices (unnamed/unassigned)
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
 *
 * @deprecated Use allocateTieredVoices instead for better voice distribution
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
 * Uses the same tiered logic as allocateTieredVoices
 *
 * @param sortedCharacters - Characters sorted by line count (descending)
 * @param currentVoiceMap - Current voice assignments
 * @param clickedIndex - Index of row where button clicked (randomize BELOW this)
 * @param enabledVoices - All enabled voices
 * @param narratorVoice - Narrator voice to reserve
 * @param bookLanguage - Detected book language
 * @param frequency - Speaking frequency per character (optional, recalculated if missing)
 */
export function randomizeBelow(
  sortedCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  clickedIndex: number,
  enabledVoices: VoiceOption[],
  narratorVoice: string,
  bookLanguage: DetectedLanguage,
  frequency?: Map<string, number>,
): Map<string, string> {
  const newMap = new Map(currentVoiceMap);

  if (clickedIndex >= sortedCharacters.length - 1) {
    return newMap;
  }

  // Collect reserved voices (narrator + all voices up to and including clickedIndex)
  const reserved = new Set<string>([narratorVoice]);
  for (let i = 0; i <= clickedIndex; i++) {
    const voice = currentVoiceMap.get(sortedCharacters[i].canonicalName);
    if (voice) reserved.add(voice);
  }

  // Build priority pool with deduplication (excludes reserved voices)
  const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);

  // Convert VoiceOption[] to VoicePool format
  const voicePool: VoicePool = {
    male: pool.male.map((v) => v.fullValue),
    female: pool.female.map((v) => v.fullValue),
  };

  // Recalculate frequency if not provided (for UI randomization)
  const freqMap =
    frequency ??
    new Map<string, number>(
      sortedCharacters.map((c) => [
        c.canonicalName,
        Math.max(0, 1000 - sortedCharacters.indexOf(c) * 10),
      ]),
    );

  // Get characters below clicked index
  const charsBelow = sortedCharacters.slice(clickedIndex + 1);

  // Use tiered allocation for characters below
  const allocation = allocateTieredVoices({
    characters: charsBelow,
    frequency: freqMap,
    pool: voicePool,
    narratorVoice,
    reservedVoices: reserved,
  });

  // Update voice map with new allocations
  for (const [char, voice] of allocation.voiceMap.entries()) {
    // Skip unnamed speakers
    if (!char.includes('UNNAMED')) {
      newMap.set(char, voice);
    }
  }

  return newMap;
}

/**
 * Assign voices to unmatched characters from priority pool.
 * Used after JSON import to fill gaps.
 *
 * - Characters in importedMap with valid (enabled) voices are preserved
 * - Characters with invalid voices or missing from importedMap get assigned from pool
 * - Uses buildPriorityPool for dedup + ordering
 */
export function assignUnmatchedFromPool(
  characters: LLMCharacter[],
  importedMap: Map<string, string>,
  enabledVoices: VoiceOption[],
  narratorVoice: string,
  bookLanguage: DetectedLanguage,
): Map<string, string> {
  const enabledSet = new Set(enabledVoices.map((v) => v.fullValue));
  const result = new Map<string, string>();
  const reserved = new Set<string>([narratorVoice]);

  // First pass: collect valid imported voices
  for (const char of characters) {
    const imported = importedMap.get(char.canonicalName);
    if (imported && enabledSet.has(imported)) {
      result.set(char.canonicalName, imported);
      reserved.add(imported);
    }
  }

  // Build priority pool excluding reserved voices
  const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);

  // Second pass: assign unmatched characters
  const malePool = pool.male;
  const femalePool = pool.female;
  let maleIdx = 0;
  let femaleIdx = 0;

  for (const char of characters) {
    if (result.has(char.canonicalName)) continue; // already assigned

    const genderPool =
      char.gender === 'female' && femalePool.length > 0
        ? femalePool
        : malePool.length > 0
          ? malePool
          : femalePool;

    const idx = char.gender === 'female' && femalePool.length > 0 ? femaleIdx++ : maleIdx++;

    if (genderPool.length > 0) {
      result.set(char.canonicalName, genderPool[idx % genderPool.length].fullValue);
    }
  }

  return result;
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
