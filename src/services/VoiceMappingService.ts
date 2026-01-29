// Voice Mapping Service
// Handles export/import of character-to-voice mappings

import type { LLMCharacter, SpeakerAssignment, VoiceOption } from '@/state/types';
import { countSpeakingFrequency } from '@/services/llm/CharacterUtils';
import type { DetectedLanguage } from '@/utils/languageDetection';

/** Minimum speaking percentage to include a character in export (0.05%) */
export const MIN_SPEAKING_PERCENTAGE = 0.0005;

/**
 * A single voice mapping entry
 */
export interface VoiceMappingEntry {
  name: string;
  voice: string;
  gender: 'male' | 'female' | 'unknown';
  aliases?: string[];
}

/**
 * Voice mapping file format
 */
export interface VoiceMappingFile {
  version: 1;
  narrator: string;
  voices: VoiceMappingEntry[];
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
 * Export characters and voice mappings to JSON string
 */
export function exportToJSON(
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  narratorVoice: string
): string {
  const voices: VoiceMappingEntry[] = characters.map(char => ({
    name: char.canonicalName,
    voice: voiceMap.get(char.canonicalName) ?? '',
    gender: char.gender,
    aliases: char.variations,
  }));

  const data: VoiceMappingFile = {
    version: 1,
    narrator: narratorVoice,
    voices,
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Export characters and voice mappings to JSON string, sorted by speaking frequency
 * Filters out characters speaking less than MIN_SPEAKING_PERCENTAGE of total chunks
 */
export function exportToJSONSorted(
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string
): string {
  const frequency = countSpeakingFrequency(assignments);
  const totalChunks = assignments.length;
  const minChunks = Math.ceil(totalChunks * MIN_SPEAKING_PERCENTAGE);

  // Filter and sort characters by frequency
  const sortedCharacters = characters
    .filter(char => (frequency.get(char.canonicalName) ?? 0) >= minChunks)
    .sort((a, b) =>
      (frequency.get(b.canonicalName) ?? 0) - (frequency.get(a.canonicalName) ?? 0)
    );

  const voices: VoiceMappingEntry[] = sortedCharacters.map(char => ({
    name: char.canonicalName,
    voice: voiceMap.get(char.canonicalName) ?? '',
    gender: char.gender,
    aliases: char.variations,
  }));

  const data: VoiceMappingFile = {
    version: 1,
    narrator: narratorVoice,
    voices,
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Import voice mappings from JSON string
 * Returns entries and narrator voice
 */
export function importFromJSON(json: string): {
  entries: VoiceMappingEntry[];
  narrator: string;
} {
  const data = JSON.parse(json) as VoiceMappingFile;

  if (!data.version || data.version !== 1) {
    throw new Error('Invalid voice mapping file version');
  }

  if (!Array.isArray(data.voices)) {
    throw new Error('Invalid voice mapping file: missing voices array');
  }

  return {
    entries: data.voices,
    narrator: data.narrator ?? '',
  };
}

/**
 * Apply imported entries to existing characters and voice map
 * Only updates characters that exist in both the import and current list
 */
export function applyImportedMappings(
  importedEntries: VoiceMappingEntry[],
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>
): Map<string, string> {
  const newMap = new Map(currentVoiceMap);
  const importMap = new Map(importedEntries.map(e => [e.name.toLowerCase(), e]));

  for (const char of currentCharacters) {
    const imported = importMap.get(char.canonicalName.toLowerCase());
    if (imported && imported.voice) {
      newMap.set(char.canonicalName, imported.voice);
      // Also update variations
      for (const variation of char.variations) {
        newMap.set(variation, imported.voice);
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
