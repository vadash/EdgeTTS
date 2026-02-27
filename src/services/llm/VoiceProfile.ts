import type {
  CharacterEntry,
  LLMCharacter,
  SpeakerAssignment,
  VoiceOption,
  VoiceProfileFile,
} from '@/state/types';
import { IMPORTANCE_THRESHOLD } from '@/state/types';
import type { DetectedLanguage } from '@/utils/languageDetection';
import { allocateTiered, randomizeBelow } from '../VoiceAllocator';
import { countSpeakingFrequency } from './CharacterUtils';
import { matchCharacter } from './NameMatcher';

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
  sessionName: string,
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
    const matchedEntry = existingProfile ? matchCharacter(char, merged) : undefined;

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
        bookAppearances: 1,
      };
    }
  }

  // 5. Build output
  const output: VoiceProfileFile = {
    version: 2,
    narrator: narratorVoice,
    totalLines: newTotalLines,
    characters: merged,
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
  currentCharacters: LLMCharacter[],
): {
  voiceMap: Map<string, string>;
  matchedCharacters: Set<string>;
  unmatchedCharacters: string[];
} {
  const profile = JSON.parse(profileJson);

  if (profile.version !== 2) {
    throw new Error('Unsupported voice profile format. Re-export from a current session.');
  }

  const voiceProfile = profile as VoiceProfileFile;
  const voiceMap = new Map<string, string>();
  const matchedCharacters = new Set<string>();
  const unmatchedCharacters: string[] = [];

  for (const char of currentCharacters) {
    // First try exact canonical name match
    let matchedEntry = Object.values(voiceProfile.characters).find(
      (entry) => entry.canonicalName === char.canonicalName,
    );

    // If no exact match, try fuzzy matching via matchCharacter
    if (!matchedEntry) {
      matchedEntry = matchCharacter(char, voiceProfile.characters);
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
 * @returns Map of character name to voice ID
 */
export function assignVoicesTiered(
  characters: CharacterEntry[],
  availableVoices: VoiceOption[],
  narratorVoice: string,
): Map<string, string> {
  return allocateTiered(
    characters.map((c) => ({
      canonicalName: c.canonicalName,
      voice: c.voice,
      lines: c.lines,
    })),
    availableVoices,
    narratorVoice,
  );
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
 * Randomizes voice assignments for characters below a given index
 * Re-exports from VoiceAllocator for backward compatibility
 */
export function randomizeBelowVoices(params: RandomizeBelowParams): Map<string, string> {
  return randomizeBelow(
    params.sortedCharacters,
    params.currentVoiceMap,
    params.clickedIndex,
    params.enabledVoices,
    params.narratorVoice,
    params.bookLanguage,
  );
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
