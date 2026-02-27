import type { LLMCharacter, SpeakerAssignment } from '@/state/types';

/**
 * Normalize canonicalNames to use the longest variation.
 * This prevents merge validation failures when LLM picks a longer variation as "keep".
 */
export function normalizeCanonicalNames(characters: LLMCharacter[]): LLMCharacter[] {
  return characters.map((c) => {
    const longest = c.variations.reduce((a, b) => (a.length >= b.length ? a : b), c.canonicalName);
    return {
      ...c,
      canonicalName: longest,
    };
  });
}

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
 * Apply merge groups to create final character list
 * mergeGroups: array of 0-based index arrays, first index is "keep"
 */
export function applyMergeGroups(
  characters: LLMCharacter[],
  mergeGroups: number[][],
): LLMCharacter[] {
  const mergedIndices = new Set<number>();
  const result: LLMCharacter[] = [];

  // Process merge groups
  for (const group of mergeGroups) {
    if (group.length < 2) continue;

    const [keepIdx, ...absorbIdxs] = group;
    const keep = characters[keepIdx];
    if (!keep) continue;

    const absorbed = absorbIdxs.map((i) => characters[i]).filter(Boolean);
    const allChars = [keep, ...absorbed];

    // Merge variations and pick first non-unknown gender
    const merged: LLMCharacter = {
      canonicalName: keep.canonicalName,
      variations: [...new Set(allChars.flatMap((c) => c.variations))],
      gender: allChars.find((c) => c.gender !== 'unknown')?.gender || 'unknown',
    };

    result.push(merged);
    for (const i of group) {
      mergedIndices.add(i);
    }
  }

  // Add unchanged characters
  characters.forEach((char, i) => {
    if (!mergedIndices.has(i)) {
      result.push({ ...char });
    }
  });

  return result;
}

/**
 * Count speaking frequency per character from speaker assignments
 * Returns a map of speaker name → sentence count (excludes narrator)
 */
export function countSpeakingFrequency(assignments: SpeakerAssignment[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
    }
  }
  return frequency;
}
