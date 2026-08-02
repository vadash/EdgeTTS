import type { LLMCharacter, SpeakerAssignment } from '@/state/types';

export interface CodeMapping {
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
}

/**
 * Length of each speaker code in hex characters (e.g. "A3F1" = 4 chars).
 * Mirrors oh-my-pi's hashline snapshot tag format for compact, opaque tokens.
 */
export const SPEAKER_CODE_LENGTH = 4;

const UNNAMED_SPEAKERS = ['MALE_UNNAMED', 'FEMALE_UNNAMED', 'UNKNOWN_UNNAMED'] as const;

/**
 * Generate a single random uppercase hex code of {@link SPEAKER_CODE_LENGTH} chars.
 * Uses crypto.getRandomValues for cryptographic-quality randomness available in
 * both browser and Node.js environments.
 */
function randomHexCode(): string {
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] & 0xffff).toString(16).padStart(SPEAKER_CODE_LENGTH, '0').toUpperCase();
}

/**
 * Draw `count` mutually-unique random hex codes, rejecting collisions.
 * With 65 536 possible values and typical book character counts (<30), redraws
 * are rare and the loop terminates quickly.
 */
function generateUniqueHexCodes(count: number): string[] {
  const codes: string[] = [];
  const used = new Set<string>();
  while (codes.length < count) {
    const code = randomHexCode();
    if (!used.has(code)) {
      used.add(code);
      codes.push(code);
    }
  }
  return codes;
}

/**
 * Build code mapping for characters using random 4-hex codes (e.g. "A3F1").
 * Random codes prevent LLMs from falling into positional routines where the
 * same character always receives the same code across different books.
 */
export function buildCodeMapping(characters: LLMCharacter[]): CodeMapping {
  return buildCodeMappingFromNames(characters.map((c) => c.canonicalName));
}

/**
 * Build code mapping from character names using random 4-hex codes.
 * Also adds MALE_UNNAMED, FEMALE_UNNAMED, and UNKNOWN_UNNAMED codes.
 * Each call produces a fresh random mapping — the same character list
 * yields different codes across invocations.
 */
export function buildCodeMappingFromNames(names: string[]): CodeMapping {
  const allNames = [...names, ...UNNAMED_SPEAKERS];
  const codes = generateUniqueHexCodes(allNames.length);

  const nameToCode = new Map<string, string>();
  const codeToName = new Map<string, string>();
  for (let i = 0; i < allNames.length; i++) {
    nameToCode.set(allNames[i], codes[i]);
    codeToName.set(codes[i], allNames[i]);
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
 * Returns a map of speaker name -> sentence count (excludes narrator)
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

const BEFORE_NAME = '(?<![\\p{L}\\p{N}])';
const AFTER_NAME = '(?![\\p{L}\\p{N}])';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cull characters whose name variations appear fewer than threshold times in the text.
 * Removes hallucinated and ultra-minor characters before the expensive LLM merge step.
 * Matches whole words only (Unicode word boundaries) so substrings inside other words
 * do not inflate the count — e.g. "Eva" no longer matches "evaluation".
 */
export function cullByFrequency(
  characters: LLMCharacter[],
  fullText: string,
  threshold: number = 3,
): LLMCharacter[] {
  return characters.filter((char) => {
    let totalMentions = 0;

    for (const variation of char.variations) {
      if (variation.length < 3) continue;

      const pattern = new RegExp(
        `${BEFORE_NAME}${escapeRegExp(variation.toLowerCase())}${AFTER_NAME}`,
        'gu',
      );
      const matches = fullText.match(pattern);
      if (matches) totalMentions += matches.length;
    }

    return totalMentions >= threshold;
  });
}
