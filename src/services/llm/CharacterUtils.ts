import type { LLMCharacter, SpeakerAssignment } from '@/state/types';

export interface CodeMapping {
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
}

export interface AssignContext {
  characters: LLMCharacter[];
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
  numberedParagraphs: string;
  sentenceCount: number;
}

/**
 * Mirrors oh-my-pi's hashline snapshot tag format for compact, opaque tokens.
 */
export const SPEAKER_CODE_LENGTH = 4;

const UNNAMED_SPEAKERS = ['MALE_UNNAMED', 'FEMALE_UNNAMED', 'UNKNOWN_UNNAMED'] as const;

/**
 * Uses crypto.getRandomValues for cryptographic-quality randomness in both
 * browser and Node.js.
 */
function randomHexCode(): string {
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] & 0xffff).toString(16).padStart(SPEAKER_CODE_LENGTH, '0').toUpperCase();
}

/**
 * The 65 536-value code space keeps redraws rare at book-scale character
 * counts (<30), so the rejection loop terminates quickly. `randomCode` is
 * injectable so tests can pin deterministic codes.
 */
function generateUniqueHexCodes(count: number, randomCode: () => string = randomHexCode): string[] {
  const codes: string[] = [];
  const used = new Set<string>();
  while (codes.length < count) {
    const code = randomCode();
    if (!used.has(code)) {
      used.add(code);
      codes.push(code);
    }
  }
  return codes;
}

/**
 * Random codes prevent LLMs from falling into positional routines where the
 * same character always receives the same code across different books.
 * `randomCode` is injectable so tests can pin deterministic codes.
 */
export function buildCodeMapping(
  characters: LLMCharacter[],
  randomCode: () => string = randomHexCode,
): CodeMapping {
  return buildCodeMappingFromNames(
    characters.map((c) => c.canonicalName),
    randomCode,
  );
}

/**
 * Also assigns codes for MALE_UNNAMED, FEMALE_UNNAMED, and UNKNOWN_UNNAMED.
 * Each call produces a fresh random mapping, so the same name list yields
 * different codes across invocations. `randomCode` is injectable so tests
 * can pin deterministic codes.
 */
export function buildCodeMappingFromNames(
  names: string[],
  randomCode: () => string = randomHexCode,
): CodeMapping {
  const allNames = [...names, ...UNNAMED_SPEAKERS];
  const codes = generateUniqueHexCodes(allNames.length, randomCode);

  const nameToCode = new Map<string, string>();
  const codeToName = new Map<string, string>();
  for (let i = 0; i < allNames.length; i++) {
    nameToCode.set(allNames[i], codes[i]);
    codeToName.set(codes[i], allNames[i]);
  }

  return { nameToCode, codeToName };
}

/**
 * Merge characters from multiple Blocks, deduplicating by canonical name.
 */
export function mergeCharacters(characters: LLMCharacter[]): LLMCharacter[] {
  const merged = new Map<string, LLMCharacter>();

  for (const char of characters) {
    const key = char.canonicalName.toLowerCase();
    const existing = merged.get(key);

    if (existing) {
      const allVariations = new Set([...existing.variations, ...char.variations]);
      existing.variations = Array.from(allVariations);

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
 * mergeGroups: array of 0-based index arrays, first index is "keep"
 */
export function applyMergeGroups(
  characters: LLMCharacter[],
  mergeGroups: number[][],
): LLMCharacter[] {
  const mergedIndices = new Set<number>();
  const result: LLMCharacter[] = [];

  for (const group of mergeGroups) {
    if (group.length < 2) continue;

    const [keepIdx, ...absorbIdxs] = group;
    const keep = characters[keepIdx];
    if (!keep) continue;

    const absorbed = absorbIdxs.map((i) => characters[i]).filter(Boolean);
    const allChars = [keep, ...absorbed];

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

  characters.forEach((char, i) => {
    if (!mergedIndices.has(i)) {
      result.push({ ...char });
    }
  });

  return result;
}

/**
 * Returns a map of speaker name -> sentence count (excludes the Narrator).
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
 * Culls Characters whose name variations appear fewer than `threshold` times
 * in the text, dropping hallucinated and ultra-minor Characters before the
 * Character merge pass. Matches whole words only (Unicode word boundaries),
 * so a substring inside another word does not inflate the count, e.g. "Eva"
 * inside "evaluation".
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
