import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { cullByFrequency, normalizeCanonicalNames } from './CharacterUtils';

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
});

describe('normalizeCanonicalNames', () => {
  it('should be a pass-through and NOT override canonicalName with longest variation', () => {
    const characters: LLMCharacter[] = [
      {
        canonicalName: 'Irogh',
        variations: ['Irogh', 'The Most Handsome Man'],
        gender: 'male',
      },
      {
        canonicalName: 'Bacci',
        variations: ['Bacci', 'purplescaled woman'],
        gender: 'female',
      },
    ];

    const result = normalizeCanonicalNames(characters);

    // Should preserve original canonicalName, NOT override with longest variation
    expect(result[0].canonicalName).toBe('Irogh');
    expect(result[1].canonicalName).toBe('Bacci');
  });

  it('should preserve canonicalName even when variation is much longer', () => {
    const characters: LLMCharacter[] = [
      {
        canonicalName: 'Bob',
        variations: ['Bob', 'Robert Smith the Third of the Kingdom of Farlandia'],
        gender: 'male',
      },
    ];

    const result = normalizeCanonicalNames(characters);

    expect(result[0].canonicalName).toBe('Bob');
  });
});
