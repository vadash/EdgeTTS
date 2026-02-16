import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment, CharacterEntry, VoiceOption, VoiceAssignment as VoiceAssignmentResult } from '@/state/types';
import { matchCharacter } from './NameMatcher';
import { countSpeakingFrequency } from './CharacterUtils';
import { IMPORTANCE_THRESHOLD } from '@/state/types';
import type { DetectedLanguage } from '@/utils/languageDetection';

/**
 * Export to cumulative profile format (version 2)
 * Merges existing profile + current session's characters
 */
export function exportToProfile(
  existingProfile: VoiceProfileFile | null,
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string,
  sessionName: string
): string {

  // 1. Count current session's dialogue per character
  const currentCounts = countSpeakingFrequency(assignments);
  const currentTotalLines = assignments.length;

  // 2. Calculate new global total
  const previousTotalLines = existingProfile?.totalLines ?? 0;
  const newTotalLines = previousTotalLines + currentTotalLines;

  // 3. Start with existing characters or empty
  const merged: Record<string, CharacterEntry> = {};
  if (existingProfile) {
    for (const [key, entry] of Object.entries(existingProfile.characters)) {
      merged[key] = { ...entry };
    }
  }

  // 4. Update/add current session's characters
  for (const char of currentCharacters) {
    const currentLines = currentCounts.get(char.canonicalName) ?? 0;

    // Try to find matching entry in existing profile
    const matchedEntry = existingProfile
      ? matchCharacter(char, merged)
      : undefined;

    if (matchedEntry) {
      // Existing: update counts
      matchedEntry.lines += currentLines;
      matchedEntry.percentage = (matchedEntry.lines / newTotalLines) * 100;
      matchedEntry.lastSeenIn = sessionName;
      matchedEntry.bookAppearances++;

      // Update voice if changed
      const newVoice = currentVoiceMap.get(char.canonicalName);
      if (newVoice) matchedEntry.voice = newVoice;

      // Merge aliases (both ways: from profile and from current extraction)
      for (const alias of char.variations) {
        if (!matchedEntry.aliases.includes(alias)) {
          matchedEntry.aliases.push(alias);
        }
      }
    } else {
      // New character - use canonical name as key
      const key = char.canonicalName.toLowerCase().replace(/\s+/g, '_');
      merged[key] = {
        canonicalName: char.canonicalName,
        voice: currentVoiceMap.get(char.canonicalName) ?? '',
        gender: char.gender,
        aliases: char.variations,
        lines: currentLines,
        percentage: (currentLines / newTotalLines) * 100,
        lastSeenIn: sessionName,
        bookAppearances: 1
      };
    }
  }

  // 5. Build output
  const output: VoiceProfileFile = {
    version: 2,
    narrator: narratorVoice,
    totalLines: newTotalLines,
    characters: merged
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Import profile and match against current session's characters
 * @param profileJson JSON string from voices.json file
 * @param currentCharacters Characters extracted from current session
 * @returns Object with voiceMap, matchedCharacters, and unmatchedCharacters
 */
export function importProfile(
  profileJson: string,
  currentCharacters: LLMCharacter[]
): {
  voiceMap: Map<string, string>;
  matchedCharacters: Set<string>;
  unmatchedCharacters: string[];
} {
  const profile: VoiceProfileFile = JSON.parse(profileJson);

  const voiceMap = new Map<string, string>();
  const matchedCharacters = new Set<string>();
  const unmatchedCharacters: string[] = [];

  for (const char of currentCharacters) {
    // First try exact canonical name match
    let matchedEntry = Object.values(profile.characters).find(
      entry => entry.canonicalName === char.canonicalName
    );

    // If no exact match, try fuzzy matching via matchCharacter
    if (!matchedEntry) {
      matchedEntry = matchCharacter(char, profile.characters);
    }

    if (matchedEntry) {
      voiceMap.set(char.canonicalName, matchedEntry.voice);
      matchedCharacters.add(char.canonicalName);
    } else {
      unmatchedCharacters.push(char.canonicalName);
    }
  }

  return { voiceMap, matchedCharacters, unmatchedCharacters };
}

/**
 * Check if character should be visible in UI
 * @param entry Character entry from profile
 * @returns true if percentage >= IMPORTANCE_THRESHOLD
 */
export function isCharacterVisible(entry: CharacterEntry): boolean {
  return entry.percentage >= IMPORTANCE_THRESHOLD;
}

/**
 * Tiered voice assignment
 * Top N characters get unique voices, remaining characters share voices
 * @param characters Character entries sorted by importance (will be re-sorted)
 * @param availableVoices Available voice options
 * @param narratorVoice Narrator voice to exclude from assignment
 * @returns Map of character name to VoiceAssignment
 */
export function assignVoicesTiered(
  characters: CharacterEntry[],
  availableVoices: VoiceOption[],
  narratorVoice: string
): Map<string, VoiceAssignmentResult> {

  // 1. Filter out narrator, sort by lines descending
  const sorted = characters
    .filter(c => c.voice !== narratorVoice)
    .sort((a, b) => b.lines - a.lines);

  const result = new Map<string, VoiceAssignmentResult>();
  const voiceCount = availableVoices.length;

  // 2. Top N get unique voices
  for (let i = 0; i < Math.min(voiceCount, sorted.length); i++) {
    result.set(sorted[i].canonicalName, {
      character: sorted[i].canonicalName,
      voice: availableVoices[i].fullValue,
      shared: false
    });
  }

  // 3. Rest get shared voices (cycle through all)
  for (let i = voiceCount; i < sorted.length; i++) {
    result.set(sorted[i].canonicalName, {
      character: sorted[i].canonicalName,
      voice: availableVoices[i % voiceCount].fullValue,
      shared: true
    });
  }

  return result;
}

/**
 * Parameters for randomizeBelowVoices function
 */
export interface RandomizeBelowParams {
  /** Characters sorted by line count (descending) */
  sortedCharacters: LLMCharacter[];
  /** Current voice assignments */
  currentVoiceMap: Map<string, string>;
  /** Index of row where button clicked (randomize BELOW this) */
  clickedIndex: number;
  /** All enabled voices */
  enabledVoices: VoiceOption[];
  /** Narrator voice to reserve */
  narratorVoice: string;
  /** Detected book language */
  bookLanguage: DetectedLanguage;
}

/**
 * Sorts voices by priority for randomization
 * Priority: book language voices first, then rest alphabetically
 * Excludes narrator voice from the result
 */
export function sortVoicesByPriority(
  voices: VoiceOption[],
  bookLanguage: DetectedLanguage,
  narratorVoice: string
): VoiceOption[] {
  // Filter out narrator voice
  const filtered = voices.filter(v => v.fullValue !== narratorVoice);

  // Language prefix to match (e.g., 'en' matches 'en-US', 'en-GB')
  const langPrefix = bookLanguage === 'ru' ? 'ru' : 'en';

  // Separate into book language and other
  const bookLangVoices: VoiceOption[] = [];
  const otherVoices: VoiceOption[] = [];

  for (const voice of filtered) {
    if (voice.locale.startsWith(langPrefix)) {
      bookLangVoices.push(voice);
    } else {
      otherVoices.push(voice);
    }
  }

  // Sort each group alphabetically by fullValue
  bookLangVoices.sort((a, b) => a.fullValue.localeCompare(b.fullValue));
  otherVoices.sort((a, b) => a.fullValue.localeCompare(b.fullValue));

  return [...bookLangVoices, ...otherVoices];
}

/**
 * Randomizes voice assignments for characters below a given index
 *
 * Algorithm:
 * 1. Collect voices assigned to characters at indices 0..clickedIndex (reserved)
 * 2. Add narrator voice to reserved set
 * 3. Filter enabled voices: remove reserved, sort by priority
 * 4. For each character below clickedIndex:
 *    - Filter voices by matching gender
 *    - Pick next voice from filtered pool (cycle if exhausted)
 * 5. Return new voice map
 */
export function randomizeBelowVoices(params: RandomizeBelowParams): Map<string, string> {
  const {
    sortedCharacters,
    currentVoiceMap,
    clickedIndex,
    enabledVoices,
    narratorVoice,
    bookLanguage,
  } = params;

  // Start with copy of current map
  const newMap = new Map(currentVoiceMap);

  // Nothing to do if clicked on last item
  if (clickedIndex >= sortedCharacters.length - 1) {
    return newMap;
  }

  // Collect reserved voices (from characters at/above clicked index + narrator)
  const reservedVoices = new Set<string>();
  reservedVoices.add(narratorVoice);
  for (let i = 0; i <= clickedIndex; i++) {
    const charName = sortedCharacters[i].canonicalName;
    const voice = currentVoiceMap.get(charName);
    if (voice) {
      reservedVoices.add(voice);
    }
  }

  // Get sorted available voices (excluding narrator)
  const sortedVoices = sortVoicesByPriority(enabledVoices, bookLanguage, narratorVoice);

  // Split by gender
  const availableMale = sortedVoices.filter(v => v.gender === 'male' && !reservedVoices.has(v.fullValue));
  const availableFemale = sortedVoices.filter(v => v.gender === 'female' && !reservedVoices.has(v.fullValue));

  // Track indices for cycling
  let maleIndex = 0;
  let femaleIndex = 0;

  // Assign voices to characters below clicked index
  for (let i = clickedIndex + 1; i < sortedCharacters.length; i++) {
    const char = sortedCharacters[i];
    let pool: VoiceOption[];
    let poolIndex: number;

    if (char.gender === 'female') {
      pool = availableFemale.length > 0 ? availableFemale : availableMale;
      poolIndex = char.gender === 'female' && availableFemale.length > 0 ? femaleIndex : maleIndex;
    } else {
      // male or unknown -> use male pool
      pool = availableMale.length > 0 ? availableMale : availableFemale;
      poolIndex = availableMale.length > 0 ? maleIndex : femaleIndex;
    }

    if (pool.length > 0) {
      const voice = pool[poolIndex % pool.length];
      newMap.set(char.canonicalName, voice.fullValue);

      // Increment correct index
      if (char.gender === 'female' && availableFemale.length > 0) {
        femaleIndex++;
      } else {
        maleIndex++;
      }
    }
  }

  return newMap;
}

/**
 * Download JSON as a file
 */
export function downloadJSON(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read JSON file from user input
 */
export async function readJSONFile(file: File): Promise<string> {
  return file.text();
}
