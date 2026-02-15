# Implementation Plan - Cumulative Voice Profiles

> **Reference:** `docs/designs/2026-02-16-series-profile-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

This plan implements cumulative voice profiles for audiobook series processing. Each session's `voices.json` contains ALL characters from previous sessions, enabling automatic voice carry-forward across books.

**Key Constants:**
- `IMPORTANCE_THRESHOLD = 0.005` (0.5% - minimum speaking percentage to show character in UI)
- `MAX_NAME_EDITS = 2` (maximum Levenshtein distance for name pair match)
- `MIN_NAME_PAIRINGS = 2` (minimum pairings required for character match)

---

## Task 1: Add Types and Constants

**Goal:** Define TypeScript types and constants for voice profiles.

**Step 1: Write the Failing Test**
- File: `src/state/types.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { VoiceProfileFile, CharacterEntry, VoiceAssignment } from '@/state/types';

  describe('VoiceProfile Types', () => {
    it('should define VoiceProfileFile type', () => {
      const profile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 1000,
        characters: {
          'harry_potter': {
            canonicalName: 'Harry Potter',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: ['Harry', 'Potter'],
            lines: 150,
            percentage: 15.0,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };
      expect(profile.version).toBe(2);
    });

    it('should define CharacterEntry type', () => {
      const entry: CharacterEntry = {
        canonicalName: 'Harry Potter',
        voice: 'en-GB-RyanNeural',
        gender: 'male',
        aliases: ['Harry'],
        lines: 100,
        percentage: 10.0,
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };
      expect(entry.canonicalName).toBe('Harry Potter');
    });

    it('should define VoiceAssignment type', () => {
      const assignment: VoiceAssignment = {
        character: 'Harry Potter',
        voice: 'en-GB-RyanNeural',
        shared: false
      };
      expect(assignment.shared).toBe(false);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/state/types.test.ts`
- Expect: "Type 'VoiceProfileFile' not found"

**Step 3: Implementation (Green)**
- File: `src/state/types.ts`
- Action: Add types and constants to the END of the file (after `ProcessedBookWithVoices`)
- Guidance: Add exactly these exports:
  ```typescript
  // Voice Profile Types (v2)
  export interface VoiceProfileFile {
    version: 2;
    narrator: string;
    totalLines: number;
    characters: Record<string, CharacterEntry>;
  }

  export interface CharacterEntry {
    canonicalName: string;
    voice: string;
    gender: 'male' | 'female' | 'unknown';
    aliases: string[];
    lines: number;
    percentage: number;
    lastSeenIn: string;
    bookAppearances: number;
  }

  export interface VoiceAssignment {
    character: string;
    voice: string;
    shared: boolean;
  }

  // Voice Profile Constants
  export const IMPORTANCE_THRESHOLD = 0.005; // 0.5%
  export const MAX_NAME_EDITS = 2;
  export const MIN_NAME_PAIRINGS = 2;
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/state/types.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/state/types.ts src/state/types.test.ts && git commit -m "feat: add voice profile types and constants"`

---

## Task 2: Implement Levenshtein Distance Function

**Goal:** Implement string edit distance calculation for name matching.

**Step 1: Write the Failing Test**
- File: `src/services/llm/NameMatcher.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { levenshtein } from './NameMatcher';

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
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: "Cannot find module './NameMatcher'"

**Step 3: Implementation (Green)**
- File: `src/services/llm/NameMatcher.ts`
- Action: Create new file with Levenshtein implementation
- Guidance:
  ```typescript
  /**
   * Calculate Levenshtein distance between two strings
   * @param a First string
   * @param b Second string
   * @returns Number of edits (insertions, deletions, substitutions) needed
   */
  export function levenshtein(a: string, b: string): number {
    const an = a ? a.length : 0;
    const bn = b ? b.length : 0;
    if (an === 0) return bn;
    if (bn === 0) return an;

    const matrix = Array(an + 1).fill(null).map(() => Array(bn + 1).fill(0));

    for (let i = 0; i <= an; i++) matrix[i][0] = i;
    for (let j = 0; j <= bn; j++) matrix[0][j] = j;

    for (let i = 1; i <= an; i++) {
      for (let j = 1; j <= bn; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    return matrix[an][bn];
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: PASS (7 tests)

**Step 5: Git Commit**
- Command: `git add src/services/llm/NameMatcher.ts src/services/llm/NameMatcher.test.ts && git commit -m "feat: implement Levenshtein distance function"`

---

## Task 3: Implement Maximum Pairings (Bipartite Matching)

**Goal:** Find maximum pairings between two name sets using greedy bipartite matching.

**Step 1: Write the Failing Test**
- File: `src/services/llm/NameMatcher.test.ts` (append to existing file)
- Code:
  ```typescript
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
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: "findMaxPairings is not defined"

**Step 3: Implementation (Green)**
- File: `src/services/llm/NameMatcher.ts`
- Action: Add `findMaxPairings` function after `levenshtein`
- Guidance:
  ```typescript
  /**
   * Find maximum pairings between two sets of names using greedy bipartite matching
   * @param setA First set of names
   * @param setB Second set of names
   * @param maxEdits Maximum Levenshtein distance for a valid pairing
   * @returns Array of [indexInSetA, indexInSetB] pairs, each name used at most once
   */
  export function findMaxPairings(
    setA: string[],
    setB: string[],
    maxEdits: number
  ): [number, number][] {
    // Build adjacency matrix: distance for each pair
    const matrix: number[][] = [];
    for (let i = 0; i < setA.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < setB.length; j++) {
        const dist = levenshtein(
          setA[i].toLowerCase(),
          setB[j].toLowerCase()
        );
        matrix[i][j] = dist <= maxEdits ? dist : Infinity;
      }
    }

    // Greedy: pick smallest distances first, no row/col reuse
    const pairings: [number, number][] = [];
    const usedRows = new Set<number>();
    const usedCols = new Set<number>();

    const cells: [number, number, number][] = [];
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        if (matrix[i][j] < Infinity) {
          cells.push([i, j, matrix[i][j]]);
        }
      }
    }
    cells.sort((a, b) => a[2] - b[2]);  // Sort by distance ascending

    for (const [row, col] of cells) {
      if (!usedRows.has(row) && !usedCols.has(col)) {
        pairings.push([row, col]);
        usedRows.add(row);
        usedCols.add(col);
      }
    }

    return pairings;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: PASS (13 tests total)

**Step 5: Git Commit**
- Command: `git add src/services/llm/NameMatcher.ts src/services/llm/NameMatcher.test.ts && git commit -m "feat: implement bipartite matching for name pairs"`

---

## Task 4: Implement Character Matching

**Goal:** Match characters using multi-pairing algorithm with MIN_NAME_PAIRINGS threshold.

**Step 1: Write the Failing Test**
- File: `src/services/llm/NameMatcher.test.ts` (append)
- Code:
  ```typescript
  import type { LLMCharacter } from '@/state/types';
  import type { CharacterEntry } from '@/state/types';
  import { IMPORTANCE_THRESHOLD, MAX_NAME_EDITS, MIN_NAME_PAIRINGS } from '@/state/types';

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
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: "matchCharacter is not defined"

**Step 3: Implementation (Green)**
- File: `src/services/llm/NameMatcher.ts`
- Action: Add `matchCharacter` function
- Guidance:
  ```typescript
  import type { LLMCharacter } from '@/state/types';
  import type { CharacterEntry } from '@/state/types';
  import { MAX_NAME_EDITS, MIN_NAME_PAIRINGS } from '@/state/types';

  /**
   * Match character against profile using multi-pairing algorithm
   * @param char Character from current session
   * @param profile Existing character entries from previous sessions
   * @returns Matching entry only if at least MIN_NAME_PAIRINGS valid pairings found
   */
  export function matchCharacter(
    char: LLMCharacter,
    profile: Record<string, CharacterEntry>
  ): CharacterEntry | undefined {
    const charNames = [char.canonicalName, ...char.variations];

    for (const entry of Object.values(profile)) {
      const entryNames = [entry.canonicalName, ...entry.aliases];

      // Find maximum pairings between the two name sets
      const pairings = findMaxPairings(charNames, entryNames, MAX_NAME_EDITS);

      // Need at least MIN_NAME_PAIRINGS independent matches
      if (pairings.length >= MIN_NAME_PAIRINGS) {
        return entry;
      }
    }

    return undefined;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: PASS (19 tests total)

**Step 5: Git Commit**
- Command: `git add src/services/llm/NameMatcher.ts src/services/llm/NameMatcher.test.ts && git commit -m "feat: implement character matching with multi-pairing algorithm"`

---

## Task 5: Implement Profile Export with Merge

**Goal:** Export cumulative profile that merges existing profile with current session characters.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { exportToProfile, importProfile, isCharacterVisible } from './VoiceProfile';
  import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment } from '@/state/types';

  describe('exportToProfile', () => {
    it('creates new profile when existingProfile is null', () => {
      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: [], gender: 'male' }
      ];
      const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
      const assignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Hello', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
        { sentenceIndex: 1, text: 'World', speaker: 'narrator', voiceId: 'en-US-GuyNeural' }
      ];

      const json = exportToProfile(null, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK1');
      const profile = JSON.parse(json) as VoiceProfileFile;

      expect(profile.version).toBe(2);
      expect(profile.narrator).toBe('en-US-GuyNeural');
      expect(profile.totalLines).toBe(2);
      expect(profile.characters['harry'].canonicalName).toBe('Harry');
      expect(profile.characters['harry'].lines).toBe(1);
    });

    it('merges existing profile with new characters', () => {
      const existingProfile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 100,
        characters: {
          'harry': {
            canonicalName: 'Harry',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: [],
            lines: 50,
            percentage: 50,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: [], gender: 'male' },
        { canonicalName: 'Ron', variations: [], gender: 'male' }
      ];
      const voiceMap = new Map([
        ['Harry', 'en-GB-RyanNeural'],
        ['Ron', 'en-US-GuyNeural']
      ]);
      const assignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
        { sentenceIndex: 1, text: 'Hey', speaker: 'Ron', voiceId: 'en-US-GuyNeural' }
      ];

      const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
      const profile = JSON.parse(json) as VoiceProfileFile;

      // Harry should have updated counts
      expect(profile.characters['harry'].lines).toBe(51);
      expect(profile.characters['harry'].bookAppearances).toBe(2);
      expect(profile.characters['harry'].lastSeenIn).toBe('BOOK2');

      // Ron should be added
      expect(profile.characters['ron'].canonicalName).toBe('Ron');
      expect(profile.characters['ron'].lines).toBe(1);

      // Total should include previous + current
      expect(profile.totalLines).toBe(102); // 100 + 2
    });

    it('merges aliases from current session into existing entry', () => {
      const existingProfile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 10,
        characters: {
          'harry': {
            canonicalName: 'Harry',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: ['Harry P.'],
            lines: 10,
            percentage: 100,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: ['Potter', 'The Boy Who Lived'], gender: 'male' }
      ];
      const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
      const assignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' }
      ];

      const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
      const profile = JSON.parse(json) as VoiceProfileFile;

      expect(profile.characters['harry'].aliases).toContain('Harry P.');
      expect(profile.characters['harry'].aliases).toContain('Potter');
      expect(profile.characters['harry'].aliases).toContain('The Boy Who Lived');
    });

    it('calculates percentage correctly for merged profile', () => {
      const existingProfile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 100, // Harry has 50 lines = 50%
        characters: {
          'harry': {
            canonicalName: 'Harry',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: [],
            lines: 50,
            percentage: 50,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: [], gender: 'male' }
      ];
      const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
      const assignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' }
      ];

      const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
      const profile = JSON.parse(json) as VoiceProfileFile;

      // Total: 101 lines, Harry: 51 lines = 51/101 ≈ 50.495%
      expect(profile.totalLines).toBe(101);
      expect(profile.characters['harry'].lines).toBe(51);
      expect(Math.abs(profile.characters['harry'].percentage - 50.495)).toBeLessThan(0.01);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: "Cannot find module './VoiceProfile'"

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Create new file with exportToProfile implementation
- Guidance:
  ```typescript
  import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment, CharacterEntry } from '@/state/types';
  import { matchCharacter } from './NameMatcher';
  import { countSpeakingFrequency } from './CharacterUtils';

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
        const key = char.canonicalName.toLowerCase().replace(/\\s+/g, '_');
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
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (4 tests)

**Step 5: Git Commit**
- Command: `git add src/services/llm/VoiceProfile.ts src/services/llm/VoiceProfile.test.ts && git commit -m "feat: implement profile export with merge logic"`

---

## Task 6: Implement Profile Import with Matching

**Goal:** Import profile and auto-match voices against current session's characters.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts` (append)
- Code:
  ```typescript
  describe('importProfile', () => {
    it('returns empty maps for empty profile', () => {
      const profile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 0,
        characters: {}
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: [], gender: 'male' }
      ];

      const result = importProfile(JSON.stringify(profile), characters);

      expect(result.voiceMap.size).toBe(0);
      expect(result.matchedCharacters.size).toBe(0);
      expect(result.unmatchedCharacters).toHaveLength(1);
    });

    it('matches characters by exact name', () => {
      const profile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 100,
        characters: {
          'harry': {
            canonicalName: 'Harry',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: ['Harry P.', 'Potter'],
            lines: 50,
            percentage: 50,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: ['Potter'], gender: 'male' }
      ];

      const result = importProfile(JSON.stringify(profile), characters);

      expect(result.voiceMap.get('Harry')).toBe('en-GB-RyanNeural');
      expect(result.matchedCharacters.has('Harry')).toBe(true);
      expect(result.unmatchedCharacters).toHaveLength(0);
    });

    it('matches characters with alias variations', () => {
      const profile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 100,
        characters: {
          'mae': {
            canonicalName: 'Mae',
            voice: 'en-US-JennyNeural',
            gender: 'female',
            aliases: ['Mai'],
            lines: 50,
            percentage: 50,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      // May/Mae/TheMay vs Mae/Mai - should match with 2 pairings
      const characters: LLMCharacter[] = [
        { canonicalName: 'May', variations: ['Mae', 'The May'], gender: 'female' }
      ];

      const result = importProfile(JSON.stringify(profile), characters);

      expect(result.voiceMap.get('May')).toBe('en-US-JennyNeural');
      expect(result.matchedCharacters.has('May')).toBe(true);
    });

    it('leaves unmatched characters in unmatchedCharacters array', () => {
      const profile: VoiceProfileFile = {
        version: 2,
        narrator: 'en-US-GuyNeural',
        totalLines: 100,
        characters: {
          'harry': {
            canonicalName: 'Harry',
            voice: 'en-GB-RyanNeural',
            gender: 'male',
            aliases: [],
            lines: 50,
            percentage: 50,
            lastSeenIn: 'BOOK1',
            bookAppearances: 1
          }
        }
      };

      const characters: LLMCharacter[] = [
        { canonicalName: 'Harry', variations: [], gender: 'male' },
        { canonicalName: 'Ron', variations: [], gender: 'male' }
      ];

      const result = importProfile(JSON.stringify(profile), characters);

      expect(result.voiceMap.get('Harry')).toBe('en-GB-RyanNeural');
      expect(result.unmatchedCharacters).toContain('Ron');
      expect(result.unmatchedCharacters).toHaveLength(1);
    });

    it('throws on invalid JSON', () => {
      expect(() => {
        importProfile('invalid json', []);
      }).toThrow();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: "importProfile is not defined"

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Add `importProfile` function after `exportToProfile`
- Guidance:
  ```typescript
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
      const matchedEntry = matchCharacter(char, profile.characters);

      if (matchedEntry) {
        voiceMap.set(char.canonicalName, matchedEntry.voice);
        matchedCharacters.add(char.canonicalName);
      } else {
        unmatchedCharacters.push(char.canonicalName);
      }
    }

    return { voiceMap, matchedCharacters, unmatchedCharacters };
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (9 tests total)

**Step 5: Git Commit**
- Command: `git add src/services/llm/VoiceProfile.ts src/services/llm/VoiceProfile.test.ts && git commit -m "feat: implement profile import with character matching"`

---

## Task 7: Implement Character Visibility Helper

**Goal:** Helper function to check if character should be visible in UI based on IMPORTANCE_THRESHOLD.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts` (append)
- Code:
  ```typescript
  import { IMPORTANCE_THRESHOLD } from '@/state/types';

  describe('isCharacterVisible', () => {
    it('returns false for characters below threshold', () => {
      const entry: CharacterEntry = {
        canonicalName: 'Minor',
        voice: 'en-US-GuyNeural',
        gender: 'male',
        aliases: [],
        lines: 1,
        percentage: 0.3, // Below 0.5%
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };

      expect(isCharacterVisible(entry)).toBe(false);
    });

    it('returns true for characters at or above threshold', () => {
      const entry1: CharacterEntry = {
        canonicalName: 'Important',
        voice: 'en-US-GuyNeural',
        gender: 'male',
        aliases: [],
        lines: 10,
        percentage: 0.5, // Exactly threshold
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };

      const entry2: CharacterEntry = {
        canonicalName: 'Main',
        voice: 'en-US-GuyNeural',
        gender: 'male',
        aliases: [],
        lines: 100,
        percentage: 15.0,
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };

      expect(isCharacterVisible(entry1)).toBe(true);
      expect(isCharacterVisible(entry2)).toBe(true);
    });

    it('uses IMPORTANCE_THRESHOLD constant', () => {
      const entry: CharacterEntry = {
        canonicalName: 'Threshold',
        voice: 'en-US-GuyNeural',
        gender: 'male',
        aliases: [],
        lines: 5,
        percentage: IMPORTANCE_THRESHOLD,
        lastSeenIn: 'BOOK1',
        bookAppearances: 1
      };

      expect(isCharacterVisible(entry)).toBe(true);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: "isCharacterVisible is not defined"

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Add `isCharacterVisible` function
- Guidance:
  ```typescript
  import { IMPORTANCE_THRESHOLD } from '@/state/types';

  /**
   * Check if character should be visible in UI
   * @param entry Character entry from profile
   * @returns true if percentage >= IMPORTANCE_THRESHOLD
   */
  export function isCharacterVisible(entry: CharacterEntry): boolean {
    return entry.percentage >= IMPORTANCE_THRESHOLD;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (12 tests total)

**Step 5: Git Commit**
- Command: `git add src/services/llm/VoiceProfile.ts src/services/llm/VoiceProfile.test.ts && git commit -m "feat: add character visibility helper function"`

---

## Task 8: Implement Tiered Voice Assignment

**Goal:** Assign unique voices to top characters, share remaining voices among minor characters.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts` (append)
- Code:
  ```typescript
  import { assignVoicesTiered } from './VoiceProfile';
  import type { VoiceOption } from '@/state/types';

  describe('assignVoicesTiered', () => {
    const createVoiceOptions = (): VoiceOption[] => [
      { locale: 'en-US', name: 'Voice1', fullValue: 'voice-1', gender: 'male' },
      { locale: 'en-US', name: 'Voice2', fullValue: 'voice-2', gender: 'male' },
      { locale: 'en-US', name: 'Voice3', fullValue: 'voice-3', gender: 'male' },
    ];

    const createCharacterEntries = (): CharacterEntry[] => [
      { canonicalName: 'Main1', voice: '', gender: 'male', aliases: [], lines: 100, percentage: 50, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Main2', voice: '', gender: 'male', aliases: [], lines: 80, percentage: 40, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Main3', voice: '', gender: 'male', aliases: [], lines: 60, percentage: 30, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Minor1', voice: '', gender: 'male', aliases: [], lines: 5, percentage: 2.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Minor2', voice: '', gender: 'male', aliases: [], lines: 3, percentage: 1.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    ];

    it('assigns unique voices to top N characters (N = voice count)', () => {
      const voices = createVoiceOptions();
      const characters = createCharacterEntries();
      const narratorVoice = 'narrator-voice';

      const result = assignVoicesTiered(characters, voices, narratorVoice);

      // Top 3 get unique voices
      expect(result.get('Main1')?.shared).toBe(false);
      expect(result.get('Main2')?.shared).toBe(false);
      expect(result.get('Main3')?.shared).toBe(false);

      // They should have different voices
      const main1Voice = result.get('Main1')?.voice;
      const main2Voice = result.get('Main2')?.voice;
      const main3Voice = result.get('Main3')?.voice;
      expect(new Set([main1Voice, main2Voice, main3Voice]).size).toBe(3);
    });

    it('assigns shared voices to remaining characters', () => {
      const voices = createVoiceOptions();
      const characters = createCharacterEntries();
      const narratorVoice = 'narrator-voice';

      const result = assignVoicesTiered(characters, voices, narratorVoice);

      // Minor characters should be marked as shared
      expect(result.get('Minor1')?.shared).toBe(true);
      expect(result.get('Minor2')?.shared).toBe(true);
    });

    it('cycles through voices for shared assignments', () => {
      const voices = createVoiceOptions();
      const characters: CharacterEntry[] = [
        ...createCharacterEntries().slice(0, 3), // 3 main characters
        { canonicalName: 'Minor1', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'Minor2', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'Minor3', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'Minor4', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      ];
      const narratorVoice = 'narrator-voice';

      const result = assignVoicesTiered(characters, voices, narratorVoice);

      // Minor 1-4 should cycle through voices 1-3
      const minorVoices = ['Minor1', 'Minor2', 'Minor3', 'Minor4'].map(
        name => result.get(name)?.voice
      );
      // All should be one of the available voices
      for (const voice of minorVoices) {
        expect(voices.map(v => v.fullValue)).toContain(voice);
      }
    });

    it('sorts characters by line count descending', () => {
      const voices = createVoiceOptions();
      const characters: CharacterEntry[] = [
        { canonicalName: 'LowLines', voice: '', gender: 'male', aliases: [], lines: 5, percentage: 2.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'HighLines', voice: '', gender: 'male', aliases: [], lines: 200, percentage: 80, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'MidLines', voice: '', gender: 'male', aliases: [], lines: 100, percentage: 50, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      ];
      const narratorVoice = 'narrator-voice';

      const result = assignVoicesTiered(characters, voices, narratorVoice);

      // HighLines and MidLines should get unique voices (not shared)
      expect(result.get('HighLines')?.shared).toBe(false);
      expect(result.get('MidLines')?.shared).toBe(false);
      expect(result.get('LowLines')?.shared).toBe(true);
    });

    it('filters out narrator voice from assignments', () => {
      const voices = createVoiceOptions();
      const characters: CharacterEntry[] = [
        { canonicalName: 'Narrator', voice: 'narrator-voice', gender: 'male', aliases: [], lines: 500, percentage: 90, lastSeenIn: 'BOOK1', bookAppearances: 1 },
        { canonicalName: 'Character', voice: '', gender: 'male', aliases: [], lines: 50, percentage: 10, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      ];
      const narratorVoice = 'narrator-voice';

      const result = assignVoicesTiered(characters, voices, narratorVoice);

      // Narrator should not be in result
      expect(result.has('Narrator')).toBe(false);

      // Character should get unique voice (since narrator filtered out)
      expect(result.get('Character')?.shared).toBe(false);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: "assignVoicesTiered is not defined"

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Add `assignVoicesTiered` function
- Guidance:
  ```typescript
  import type { VoiceOption, VoiceAssignment as VoiceAssignmentResult } from '@/state/types';

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
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (17 tests total)

**Step 5: Git Commit**
- Command: `git add src/services/llm/VoiceProfile.ts src/services/llm/VoiceProfile.test.ts && git commit -m "feat: implement tiered voice assignment"`

---

## Task 9: Export Public API from VoiceProfile Module

**Goal:** Export all functions from VoiceProfile module for external use.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts` (append at end)
- Code:
  ```typescript
  describe('Module exports', () => {
    it('exports all required functions', async () => {
      const module = await import('./VoiceProfile');

      expect(typeof module.exportToProfile).toBe('function');
      expect(typeof module.importProfile).toBe('function');
      expect(typeof module.isCharacterVisible).toBe('function');
      expect(typeof module.assignVoicesTiered).toBe('function');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (exports should already exist from Task 5-8)

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Ensure all exports are present
- Guidance: Verify file has these exports:
  - `export function exportToProfile`
  - `export function importProfile`
  - `export function isCharacterVisible`
  - `export function assignVoicesTiered`

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/VoiceProfile.test.ts`
- Expect: PASS (18 tests total)

**Step 5: Git Commit**
- Command: `git commit --allow-empty -m "chore: verify VoiceProfile module exports"`

---

## Task 10: Export Public API from NameMatcher Module

**Goal:** Export all functions from NameMatcher module for external use.

**Step 1: Write the Failing Test**
- File: `src/services/llm/NameMatcher.test.ts` (append at end)
- Code:
  ```typescript
  describe('Module exports', () => {
    it('exports all required functions', async () => {
      const module = await import('./NameMatcher');

      expect(typeof module.levenshtein).toBe('function');
      expect(typeof module.findMaxPairings).toBe('function');
      expect(typeof module.matchCharacter).toBe('function');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: PASS (exports should already exist from Tasks 2-4)

**Step 3: Implementation (Green)**
- File: `src/services/llm/NameMatcher.ts`
- Action: Verify all exports are present
- Guidance: No changes needed if all functions are exported

**Step 4: Verify (Green)**
- Command: `npm test src/services/llm/NameMatcher.test.ts`
- Expect: PASS (22 tests total)

**Step 5: Git Commit**
- Command: `git commit --allow-empty -m "chore: verify NameMatcher module exports"`

---

## Summary

After completing all tasks, the following features will be implemented:

1. **Types and Constants**: `VoiceProfileFile`, `CharacterEntry`, `VoiceAssignment` with constants
2. **Levenshtein Distance**: Edit distance calculation for name matching
3. **Bipartite Matching**: Maximum pairings between name sets
4. **Character Matching**: Multi-pairing algorithm with `MIN_NAME_PAIRINGS` threshold
5. **Profile Export**: Cumulative merge of existing + new characters
6. **Profile Import**: Auto-match voices from previous sessions
7. **Character Visibility**: Filter by `IMPORTANCE_THRESHOLD`
8. **Tiered Voice Assignment**: Unique voices for main characters, shared for minor

**Total Tests**: ~40 tests across 2 test files
