/**
 * VoiceAllocator - Unified voice assignment and allocation logic
 * Consolidates logic from VoiceAssigner, VoiceRemappingStep, and VoiceProfile
 */

import type { LLMCharacter, SpeakerAssignment, VoiceOption, VoicePool } from '@/state/types';
import type { DetectedLanguage } from '@/utils/languageDetection';
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

/** Share of each gender pool reserved for unique 1:1 assignment; the tail round-robins. */
export const UNIQUE_POOL_RATIO = 0.8;

/**
 * Tracks used voices during allocation.
 *
 * Each gender pool is split once at construction: the first 80% are unique slots,
 * handed out one per character, and the remaining 20% is a shared tail that cycles
 * and may repeat. Callers sort characters by line count, so the top speakers reach
 * the unique slice first.
 */
export class VoicePoolTracker {
  private used: Set<string> = new Set();
  private pool: VoicePool;
  public narratorVoice: string;
  private cycleCounters = { male: 0, female: 0 };
  private unique: { male: string[]; female: string[] };
  private shared: { male: string[]; female: string[] };

  constructor(pool: VoicePool, narratorVoice: string, reserved: Set<string> = new Set()) {
    this.pool = pool;
    this.narratorVoice = narratorVoice;
    this.used.add(narratorVoice);
    for (const v of reserved) {
      this.used.add(v);
    }

    const split = (voices: string[]) => {
      const free = voices.filter((v) => !this.used.has(v));
      const cut = Math.ceil(free.length * UNIQUE_POOL_RATIO);
      // Tail must never be empty while voices exist, or the round-robin has nothing to cycle.
      return cut >= free.length
        ? [free.slice(0, -1), free.slice(-1)]
        : [free.slice(0, cut), free.slice(cut)];
    };
    const [uniqueMale, sharedMale] = split(pool.male);
    const [uniqueFemale, sharedFemale] = split(pool.female);
    this.unique = { male: uniqueMale, female: uniqueFemale };
    this.shared = { male: sharedMale, female: sharedFemale };
  }

  /**
   * Pick a voice for the given gender: an unused one from the 80% unique slice,
   * else cycle the shared 20% tail (repeats allowed).
   */
  pickVoice(gender: 'male' | 'female' | 'unknown'): string {
    const key = this.poolKey(gender);

    const free = this.unique[key].find((v) => !this.used.has(v));
    if (free) {
      this.used.add(free);
      return free;
    }

    // No voices at all for this gender: borrow the other pool rather than return nothing.
    if (this.pool[key].length === 0) {
      const other = key === 'male' ? 'female' : 'male';
      const borrowed = this.unique[other].find((v) => !this.used.has(v));
      if (borrowed) {
        this.used.add(borrowed);
        return borrowed;
      }
      return this.cycle(other);
    }

    return this.cycle(key);
  }

  /** Round-robin over the shared tail, falling back to the whole pool if it is empty. */
  private cycle(key: 'male' | 'female'): string {
    const tail = this.shared[key].length > 0 ? this.shared[key] : this.pool[key];
    if (tail.length === 0) return '';
    const voice = tail[this.cycleCounters[key] % tail.length];
    this.cycleCounters[key]++;
    return voice;
  }

  /** Unknown gender takes whatever pool is least used, so it never starves a gendered one. */
  private poolKey(gender: 'male' | 'female' | 'unknown'): 'male' | 'female' {
    if (gender !== 'unknown') return gender;
    return this.countUsedIn(this.pool.male) <= this.countUsedIn(this.pool.female)
      ? 'male'
      : 'female';
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
 * Voice allocation options
 */
export interface AllocateVoicesOptions {
  /** Characters to assign voices to */
  characters: LLMCharacter[];
  /** Speaking frequency per character (name -> line count); absent/empty keeps input order */
  frequency?: Map<string, number>;
  /** Voice pool to allocate from */
  pool: VoicePool;
  /** Narrator voice (reserved, never assigned) */
  narratorVoice: string;
  /** Pre-reserved voices (e.g., user-selected) */
  reservedVoices?: Set<string>;
}

/**
 * Stable frequency sort (descending); ties and absent entries keep input order, and an
 * absent/empty map skips sorting entirely. Shared by allocation and the run-log summary
 * so display order can never drift from allocation order.
 */
export function sortByFrequency(
  characters: LLMCharacter[],
  frequency?: Map<string, number>,
): LLMCharacter[] {
  if (!frequency || frequency.size === 0) return characters;
  return [...characters].sort(
    (a, b) => (frequency.get(b.canonicalName) ?? 0) - (frequency.get(a.canonicalName) ?? 0),
  );
}

/**
 * Count non-narrator speaking frequency from speaker assignments
 * (name -> number of assigned sentences)
 */
export function frequencyFromAssignments(assignments: SpeakerAssignment[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
    }
  }
  return frequency;
}

/**
 * Unique-slot count shown in the run log for a combined voice pool. The tracker applies
 * the ratio per gender pool with a never-empty tail guard, so small pools diverge; this
 * is the log's display approximation, not the split itself.
 */
export function uniqueSlotCount(poolSize: number): number {
  return Math.max(1, Math.ceil(UNIQUE_POOL_RATIO * poolSize));
}

/**
 * Voice allocation: top speakers (by frequency, descending) take the unique slice of
 * each gender pool, the rest cycle the shared tail. Without a frequency map characters
 * are served in input order. Narrator is reserved; rare/unnamed speakers get dedicated
 * voices per gender.
 */
export function allocateVoices(options: AllocateVoicesOptions): VoiceAllocation {
  const { characters, frequency, pool, narratorVoice, reservedVoices = new Set() } = options;

  const tracker = new VoicePoolTracker(pool, narratorVoice, reservedVoices);
  const voiceMap = new Map<string, string>();

  for (const char of sortByFrequency(characters, frequency)) {
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
 * Shuffle voices in place within priority tiers.
 *
 * Tier order (native non-Multilingual before Multilingual) is a hard guarantee of
 * `buildPriorityPool`, so shuffling must happen *inside* each tier — never across
 * them, or a book would get a Multilingual voice while a native one sat unused.
 */
function shuffleWithinTiers(pool: VoiceOption[]): VoiceOption[] {
  const native: VoiceOption[] = [];
  const multilingual: VoiceOption[] = [];
  for (const voice of pool) {
    (voice.name.includes('Multilingual') ? multilingual : native).push(voice);
  }
  for (const tier of [native, multilingual]) {
    for (let i = tier.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tier[i], tier[j]] = [tier[j], tier[i]];
    }
  }
  return [...native, ...multilingual];
}

/**
 * Randomize allocations for characters below a given index
 * Uses the same tiered logic as allocateVoices
 *
 * @param sortedCharacters - Characters sorted by line count (descending)
 * @param currentVoiceMap - Current voice assignments
 * @param clickedIndex - Index of row where button clicked (randomize BELOW this)
 * @param enabledVoices - All enabled voices
 * @param narratorVoice - Narrator voice to reserve
 * @param bookLanguage - Detected book language
 * @param frequency - Speaking frequency per character (name -> line count)
 * @param shuffle - Randomize pool order within priority tiers. Without this the
 *   allocation is fully deterministic: reserving rows 0..clickedIndex strips exactly
 *   the voices they consumed off the front of the pool, so every row below is handed
 *   back the voice it already had and the operation looks like a no-op.
 */
export function randomizeBelow(
  sortedCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  clickedIndex: number,
  enabledVoices: VoiceOption[],
  narratorVoice: string,
  bookLanguage: DetectedLanguage,
  frequency: Map<string, number>,
  shuffle = false,
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
    male: (shuffle ? shuffleWithinTiers(pool.male) : pool.male).map((v) => v.fullValue),
    female: (shuffle ? shuffleWithinTiers(pool.female) : pool.female).map((v) => v.fullValue),
  };

  // Get characters below clicked index
  const charsBelow = sortedCharacters.slice(clickedIndex + 1);

  // Allocate voices for characters below
  const allocation = allocateVoices({
    characters: charsBelow,
    frequency,
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
