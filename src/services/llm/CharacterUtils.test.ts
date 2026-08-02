import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import {
  SPEAKER_CODE_LENGTH,
  buildCodeMapping,
  buildCodeMappingFromNames,
  cullByFrequency,
} from './CharacterUtils';

function makeChar(
  name: string,
  variations: string[],
  gender: 'male' | 'female' | 'unknown' = 'unknown',
): LLMCharacter {
  return { canonicalName: name, variations, gender };
}

describe('cullByFrequency', () => {
  it('culled characters below threshold, keeps characters above', () => {
    const text =
      'Alice said hello. Alice went home. Alice slept. Bob was never mentioned anywhere.';
    const characters = [makeChar('Alice', ['Alice']), makeChar('Bob', ['Bob'])];

    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Alice');
  });

  it('sums mentions across all variations', () => {
    const text =
      'Catherine fought. Cat won. Catherine Foundling returned. Cat slept. Catherine smiled.';
    const characters = [makeChar('Catherine', ['Catherine', 'Cat', 'Catherine Foundling'])];

    // Catherine=3, Cat=2, "Catherine Foundling"=1 → total=6
    const result = cullByFrequency(characters, text.toLowerCase(), 5);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Catherine');
  });

  it('skips variations shorter than 3 characters', () => {
    const text = 'I went there. I came back. I saw. me too. I know.';
    const characters = [makeChar('Protagonist', ['I', 'me', 'my'])];

    // "I" (1 char), "me" (2 chars), "my" (2 chars) all skipped → 0 mentions
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(0);
  });

  it('keeps character at exact threshold (inclusive)', () => {
    const text = 'Hakram nodded. Hakram smiled. Hakram left.';
    const characters = [makeChar('Hakram', ['Hakram'])];

    // Hakram appears exactly 3 times
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Hakram');
  });

  it('culled character with zero mentions', () => {
    const text = 'Alice was here. Alice left.';
    const characters = [
      makeChar('Alice', ['Alice']),
      makeChar('HallucinatedCharacter', ['HallucinatedCharacter']),
    ];

    const result = cullByFrequency(characters, text.toLowerCase(), 1);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Alice');
  });

  it('returns empty array for empty characters input', () => {
    const result = cullByFrequency([], 'some text'.toLowerCase(), 3);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty text input', () => {
    const characters = [makeChar('Alice', ['Alice'])];

    const result = cullByFrequency(characters, '', 1);

    expect(result).toEqual([]);
  });

  it('returns all characters when all are above threshold', () => {
    const text = 'Alice and Bob sat. Alice spoke. Bob replied. Alice nodded. Bob agreed.';
    const characters = [makeChar('Alice', ['Alice']), makeChar('Bob', ['Bob'])];

    // Alice=3, Bob=3
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(2);
  });

  it('matches case-insensitively', () => {
    const text = 'catherine walked. CATHERINE ran. CatHerIne jumped.';
    const characters = [makeChar('Catherine', ['Catherine'])];

    // The function receives lowercased text and lowercases variations internally
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
  });

  it('uses default threshold of 3', () => {
    const text = 'Alice appeared once.';
    const characters = [makeChar('Alice', ['Alice'])];

    // Alice mentioned 1 time, default threshold is 3
    const result = cullByFrequency(characters, text.toLowerCase());

    expect(result).toHaveLength(0);
  });

  it('does not count substring matches inside other words', () => {
    // "eva" appears 3x inside "evaluation" but only 2x standalone → below threshold 3
    const text = 'evaluation evaluates evaluation eva eva';
    const characters = [makeChar('Eva', ['Eva'])];

    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(0);
  });

  it('counts standalone mentions beside substring matches', () => {
    // 3 standalone "eva" survive the cull even though "evaluation" still present
    const text = 'evaluation evaluates evaluation eva eva eva';
    const characters = [makeChar('Eva', ['Eva'])];

    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Eva');
  });
});

describe('buildCodeMappingFromNames', () => {
  it('produces 4-char uppercase hex codes', () => {
    const { nameToCode } = buildCodeMappingFromNames(['Alice']);
    const code = nameToCode.get('Alice')!;
    expect(code).toMatch(/^[0-9A-F]{4}$/);
    expect(code.length).toBe(SPEAKER_CODE_LENGTH);
  });

  it('assigns unique codes to every name (no collisions)', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];
    const { nameToCode } = buildCodeMappingFromNames(names);
    const codes = Array.from(nameToCode.values());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('includes unnamed speaker codes', () => {
    const { nameToCode, codeToName } = buildCodeMappingFromNames(['Alice']);
    expect(nameToCode.has('MALE_UNNAMED')).toBe(true);
    expect(nameToCode.has('FEMALE_UNNAMED')).toBe(true);
    expect(nameToCode.has('UNKNOWN_UNNAMED')).toBe(true);
    // All unnamed codes must be unique 4-hex
    for (const name of ['MALE_UNNAMED', 'FEMALE_UNNAMED', 'UNKNOWN_UNNAMED']) {
      expect(nameToCode.get(name)).toMatch(/^[0-9A-F]{4}$/);
    }
    // Reverse lookup works
    for (const [name, code] of nameToCode) {
      expect(codeToName.get(code)).toBe(name);
    }
  });

  it('produces decorrelated codes across calls with identical input', () => {
    // The core contract: same character list must NOT produce the same codes.
    // This prevents the LLM from falling into positional routines.
    const names = ['Alice', 'Bob', 'Charlie'];
    const codes1 = Array.from(buildCodeMappingFromNames(names).nameToCode.values());
    const codes2 = Array.from(buildCodeMappingFromNames(names).nameToCode.values());
    // With 65536^3 possible code-sets, an exact collision is astronomically
    // unlikely (probability ~1/2^48). At least one code must differ.
    const allMatch = codes1.every((c, i) => c === codes2[i]);
    expect(allMatch).toBe(false);
  });
});

describe('buildCodeMapping', () => {
  it('wraps character names into the same random mapping', () => {
    const chars = [makeChar('Alice', ['Alice']), makeChar('Bob', ['Bob'])];
    const { nameToCode, codeToName } = buildCodeMapping(chars);
    expect(nameToCode.has('Alice')).toBe(true);
    expect(nameToCode.has('Bob')).toBe(true);
    expect(codeToName.get(nameToCode.get('Alice')!)).toBe('Alice');
    expect(codeToName.get(nameToCode.get('Bob')!)).toBe('Bob');
  });
});
