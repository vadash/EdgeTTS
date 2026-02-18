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

  it('matches when canonical name exactly matches profile entry (single name)', () => {
    // Exact canonical match bypasses multi-pairing requirement
    const profile = createProfile([{ name: 'Harry', aliases: [] }]);
    const char: LLMCharacter = { canonicalName: 'Harry', variations: [], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('Harry');
  });

  it('matches when canonical name matches a profile alias', () => {
    const profile = createProfile([{
      name: 'Erick Flatt',
      aliases: ['Erick', 'Archmage', 'Flatt']
    }]);
    const char: LLMCharacter = { canonicalName: 'Erick', variations: [], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('Erick Flatt');
  });

  it('matches canonical name case-insensitively', () => {
    const profile = createProfile([{ name: 'HARRY', aliases: [] }]);
    const char: LLMCharacter = { canonicalName: 'harry', variations: [], gender: 'male' };
    const result = matchCharacter(char, profile);
    expect(result?.canonicalName).toBe('HARRY');
  });

  it('does not match when only a variation matches (not canonical)', () => {
    // "Dad" is a variation of current char, matches alias in profile,
    // but canonical "John" doesn't match anything — no shortcut
    const profile = createProfile([{
      name: 'Erick Flatt',
      aliases: ['Dad', 'Archmage']
    }]);
    const char: LLMCharacter = { canonicalName: 'John', variations: ['Dad'], gender: 'male' };
    const result = matchCharacter(char, profile);
    // Falls through to fuzzy matching, which won't find 2 pairings
    expect(result).toBeUndefined();
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

  describe('dynamic pairing threshold', () => {
    it('requires 3 pairings when comparing 4 names vs 9 names (min(4,9)-1=3, not capped)', () => {
      // M=4, N=9, min=4, min-1=3, which is > MIN_NAME_PAIRINGS, so required=3
      // Use truly unrelated names with distances > 2
      const profile = createProfile([
        { name: 'Alexander', aliases: ['Benjamin', 'Christopher', 'Dominic', 'Edward', 'Frederick', 'George', 'Henry', 'Ignatius'] }
      ]);
      const char: LLMCharacter = { canonicalName: 'Zephyr', variations: ['Apollo', 'Atlas'], gender: 'male' };

      // With min(4,9)-1 = 3, need 3 pairings to match
      // These names are very different, so we won't get 3 pairings
      const result = matchCharacter(char, profile);
      expect(result).toBeUndefined();
    });

    it('requires 3 pairings when comparing 4 names vs 4 names (min(4,4)-1=3)', () => {
      // M=4, N=4, min=4, min-1=3, required=3
      const profile = createProfile([
        { name: 'Alpha', aliases: ['Bravo', 'Charlie'] } // 4 names total
      ]);
      const char: LLMCharacter = { canonicalName: 'Apple', variations: ['Bat', 'Cat'], gender: 'male' }; // 4 names total

      // Only 2 good pairings at best (Apple/Alpha=5, Bat/Bravo=4, Cat/Charlie=5 - all > MAX_EDITS=2)
      const result = matchCharacter(char, profile);
      expect(result).toBeUndefined();
    });

    it('matches with 3 pairings when comparing 4 names vs 9 names', () => {
      // Create a scenario where we get exactly 3 good pairings
      const profile = createProfile([
        { name: 'Tom', aliases: ['Tim', 'Tam', 'Tomas', 'Timmeh', 'Tommy', 'Thom', 'Thomas', 'Tomek'] }
      ]);
      const char: LLMCharacter = { canonicalName: 'Tom', variations: ['Tim', 'Tam'], gender: 'male' };

      // Tom->Tom (0), Tim->Tim (0), Tam->Tam (0) = 3 pairings
      // M=4, N=9, required = max(2, 4-1) = 3
      const result = matchCharacter(char, profile);
      expect(result?.canonicalName).toBe('Tom');
    });

    it('still requires MIN_NAME_PAIRINGS=2 when comparing 2 names vs 10 names', () => {
      // M=2, N=10, min=2, min-1=1, required = max(2, 1) = 2
      const profile = createProfile([
        { name: 'Harry', aliases: ['H', 'Harr', 'Har', 'Ha', 'Potter', 'P', 'H.P.', 'HP', 'The Boy'] }
      ]);
      const char: LLMCharacter = { canonicalName: 'Harry', variations: ['H'], gender: 'male' };

      // Harry->Harry (0), H->H (0) = 2 pairings, meets threshold of 2
      const result = matchCharacter(char, profile);
      expect(result?.canonicalName).toBe('Harry');
    });
  });
});

describe('Module exports', () => {
  it('exports all required functions', async () => {
    const module = await import('./NameMatcher');

    expect(typeof module.levenshtein).toBe('function');
    expect(typeof module.findMaxPairings).toBe('function');
    expect(typeof module.matchCharacter).toBe('function');
  });
});
