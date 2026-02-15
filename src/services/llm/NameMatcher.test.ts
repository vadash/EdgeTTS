import { describe, it, expect } from 'vitest';
import { levenshtein, findMaxPairings, matchCharacter } from './NameMatcher';
import type { LLMCharacter } from '@/state/types';
import type { CharacterEntry } from '@/state/types';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length for empty string comparison', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles multiple edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is case-insensitive when lowercasing inputs', () => {
    const dist = levenshtein('Hello'.toLowerCase(), 'HELLO'.toLowerCase());
    expect(dist).toBe(0);
  });
});

describe('findMaxPairings', () => {
  it('finds no pairings when all distances exceed maxEdits', () => {
    const result = findMaxPairings(['Apple'], ['Orange'], 1);
    expect(result).toEqual([]);
  });

  it('finds single exact match pairing', () => {
    const result = findMaxPairings(['Harry'], ['Harry'], 2);
    expect(result).toEqual([[0, 0]]);
  });

  it('pairs closest matches greedily', () => {
    // May->Mae (1), May->Mai (1), Mae->Mae (0), Mae->Mai (2)
    // Greedy picks (Mae,Mae)=0 first, then (May,Mai)=1
    const result = findMaxPairings(['May', 'Mae'], ['Mae', 'Mai'], 2);
    expect(result.length).toBe(2);
    expect(result).toContainEqual([1, 0]); // (Mae, Mae)
  });

  it('does not reuse names from same set', () => {
    // With "May" matched to "Mae", can't match "Mae" to "Mai" if "Mae" already used
    const result = findMaxPairings(['May', 'Mae', 'The May'], ['Mae', 'Mai'], 2);
    expect(result.length).toBeLessThanOrEqual(2); // Max 2 pairings (only 2 in set B)
  });

  it('handles empty sets', () => {
    expect(findMaxPairings([], ['A'], 2)).toEqual([]);
    expect(findMaxPairings(['A'], [], 2)).toEqual([]);
    expect(findMaxPairings([], [], 2)).toEqual([]);
  });

  it('filters by maxEdits correctly', () => {
    // "Smith" vs "Smythe" = distance 1
    // "Smith" vs "Schmidt" = distance > 2
    const result = findMaxPairings(['Smith'], ['Smythe', 'Schmidt'], 2);
    expect(result.length).toBe(1);
    expect(result[0][1]).toBe(0); // Pairs with Smythe (index 0)
  });
});

describe('matchCharacter', () => {
  // Helper to create test profile
  const createProfile = (entries: Array<{ name: string; aliases: string[] }>): Record<string, CharacterEntry> => {
    const result: Record<string, CharacterEntry> = {};
    for (const entry of entries) {
      const key = entry.name.toLowerCase().replace(/\s+/g, '_');
      result[key] = {
        canonicalName: entry.name,
        voice: 'en-US-GuyNeural',
        gender: 'unknown',
        aliases: entry.aliases,
        lines: 100,
        percentage: 10.0,
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };
    }
    return result;
  };

  it('returns undefined when profile is empty', () => {
    const char: LLMCharacter = { canonicalName: 'Harry', variations: [], gender: 'male' };
    const result = matchCharacter(char, {});
    expect(result).toBeUndefined();
  });

  it('matches when canonical names are identical', () => {
    const profile = createProfile([{ name: 'Harry Potter', aliases: ['Harry', 'Potter'] }]);
    const char: LLMCharacter = { canonicalName: 'Harry Potter', variations: ['Harry'], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('Harry Potter');
  });

  it('requires at least MIN_NAME_PAIRINGS pairings', () => {
    // Single name on each side = only 1 possible pairing = no match
    const profile = createProfile([{ name: 'Harry', aliases: [] }]);
    const char: LLMCharacter = { canonicalName: 'Harry', variations: [], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result).toBeUndefined(); // Only 1 pairing, need MIN_NAME_PAIRINGS=2
  });

  it('matches with multiple alias pairings', () => {
    // May/Mae/TheMay vs Mae/Mai
    // (Mae,Mae)=0, (May,Mai)=1 = 2 pairings
    const profile = createProfile([{ name: 'Mae', aliases: ['Mai'] }]);
    const char: LLMCharacter = { canonicalName: 'May', variations: ['Mae', 'The May'], gender: 'female' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('Mae');
  });

  it('does not match when all pairings exceed MAX_NAME_EDITS', () => {
    const profile = createProfile([{ name: 'CompletelyDifferent', aliases: [] }]);
    const char: LLMCharacter = { canonicalName: 'Harry', variations: [], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result).toBeUndefined();
  });

  it('matches across multiple profile entries', () => {
    const profile = createProfile([
      { name: 'Harry Potter', aliases: ['Harry', 'Potter'] },
      { name: 'Ron Weasley', aliases: ['Ron'] }
    ]);
    const char: LLMCharacter = { canonicalName: 'Harry', variations: ['Potter'], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('Harry Potter');
  });
});
