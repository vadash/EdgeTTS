import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment, CharacterEntry, VoiceOption, VoiceAssignment as VoiceAssignmentResult } from '@/state/types';
import { matchCharacter } from './NameMatcher';
import { countSpeakingFrequency } from './CharacterUtils';
import { IMPORTANCE_THRESHOLD } from '@/state/types';

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
