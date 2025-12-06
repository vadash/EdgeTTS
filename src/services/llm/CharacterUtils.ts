import type { LLMCharacter, MergeResponse, SpeakerAssignment } from '@/state/types';

export interface CodeMapping {
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
}

const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Build code mapping for characters (A-Z, 0-9, a-z = 62 codes)
 */
export function buildCodeMapping(characters: LLMCharacter[]): CodeMapping {
  return buildCodeMappingFromNames(characters.map((c) => c.canonicalName));
}

/**
 * Build code mapping from character names (adds unnamed speaker codes at the end)
 */
export function buildCodeMappingFromNames(names: string[]): CodeMapping {
  const nameToCode = new Map<string, string>();
  const codeToName = new Map<string, string>();

  names.forEach((name, i) => {
    const code = i < CODES.length ? CODES[i] : `X${i}`;
    nameToCode.set(name, code);
    codeToName.set(code, name);
  });

  // Add unnamed speaker codes dynamically after character codes
  const nextIndex = names.length;
  const unnamedCodes = [
    { name: 'MALE_UNNAMED', index: nextIndex },
    { name: 'FEMALE_UNNAMED', index: nextIndex + 1 },
    { name: 'UNKNOWN_UNNAMED', index: nextIndex + 2 },
  ];

  for (const { name, index } of unnamedCodes) {
    const code = index < CODES.length ? CODES[index] : `X${index}`;
    nameToCode.set(name, code);
    codeToName.set(code, name);
  }

  return { nameToCode, codeToName };
}

/**
 * Merge characters from multiple blocks, deduplicating by name
 */
export function mergeCharacters(characters: LLMCharacter[]): LLMCharacter[] {
  const merged = new Map<string, LLMCharacter>();

  for (const char of characters) {
    const key = char.canonicalName.toLowerCase();
    const existing = merged.get(key);

    if (existing) {
      // Merge variations
      const allVariations = new Set([...existing.variations, ...char.variations]);
      existing.variations = Array.from(allVariations);

      // Prefer non-unknown gender
      if (existing.gender === 'unknown' && char.gender !== 'unknown') {
        existing.gender = char.gender;
      }
    } else {
      merged.set(key, { ...char });
    }
  }

  return Array.from(merged.values());
}

/**
 * Apply merge response to create final character list
 */
export function applyMergeResponse(characters: LLMCharacter[], mergeResponse: MergeResponse): LLMCharacter[] {
  const result: LLMCharacter[] = [];
  const characterMap = new Map(characters.map((c) => [c.canonicalName, c]));

  // Add merged characters
  for (const merge of mergeResponse.merges) {
    result.push({
      canonicalName: merge.keep,
      variations: merge.variations,
      gender: merge.gender,
    });
  }

  // Add unchanged characters
  for (const name of mergeResponse.unchanged) {
    const char = characterMap.get(name);
    if (char) {
      result.push({ ...char });
    }
  }

  return result;
}

/**
 * Count speaking frequency per character from speaker assignments
 * Returns a map of speaker name → sentence count (excludes narrator)
 */
export function countSpeakingFrequency(
  assignments: SpeakerAssignment[]
): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
    }
  }
  return frequency;
}
