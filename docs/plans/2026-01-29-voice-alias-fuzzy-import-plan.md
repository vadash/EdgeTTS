# Implementation Plan - Voice Alias Fuzzy Import

> **Reference:** `docs/designs/2026-01-29-voice-alias-fuzzy-import-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add `aliases` field to VoiceMappingEntry type

**Goal:** Extend the interface to support optional aliases array.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  describe('VoiceMappingEntry with aliases', () => {
    it('exports aliases from character variations', () => {
      const characters: LLMCharacter[] = [
        { canonicalName: 'The System', variations: ['The System', 'System'], gender: 'female' },
      ];
      const voiceMap = new Map([['The System', 'en-US, MichelleNeural']]);

      const json = exportToJSON(characters, voiceMap, 'en-US, GuyNeural');
      const parsed = JSON.parse(json);

      expect(parsed.voices[0].aliases).toEqual(['The System', 'System']);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `aliases` is undefined

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Action:
  1. Add `aliases?: string[];` to `VoiceMappingEntry` interface
  2. Update `exportToJSON()` to include `aliases: char.variations`

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add aliases field to VoiceMappingEntry"`

---

## Task 2: Update `exportToJSONSorted()` to include aliases

**Goal:** Ensure sorted export also includes aliases.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  describe('exportToJSONSorted with aliases', () => {
    it('includes aliases in sorted export', () => {
      const characters: LLMCharacter[] = [
        { canonicalName: 'Cale', variations: ['Cale', 'Cale Cobbs'], gender: 'male' },
      ];
      const voiceMap = new Map([['Cale', 'en-IE, ConnorNeural']]);
      const assignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Hello', speaker: 'Cale', voiceId: 'en-IE, ConnorNeural' },
      ];

      const json = exportToJSONSorted(characters, voiceMap, assignments, 'en-US, GuyNeural');
      const parsed = JSON.parse(json);

      expect(parsed.voices[0].aliases).toEqual(['Cale', 'Cale Cobbs']);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `aliases` is undefined in sorted export

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Action: Update `exportToJSONSorted()` to include `aliases: char.variations`

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add aliases to exportToJSONSorted"`

---

## Task 3: Add `normalizeForMatch()` function

**Goal:** Create utility to normalize names for fuzzy matching.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  describe('normalizeForMatch', () => {
    it('lowercases input', () => {
      expect(normalizeForMatch('The System')).toBe('system');
    });

    it('strips "The " prefix', () => {
      expect(normalizeForMatch('The Dark Lord')).toBe('dark lord');
    });

    it('strips "A " prefix', () => {
      expect(normalizeForMatch('A Guard')).toBe('guard');
    });

    it('strips "An " prefix', () => {
      expect(normalizeForMatch('An Elder')).toBe('elder');
    });

    it('strips title prefixes', () => {
      expect(normalizeForMatch('Professor Rinkle')).toBe('rinkle');
      expect(normalizeForMatch('Lord Azaroth')).toBe('azaroth');
      expect(normalizeForMatch('Lady Morgana')).toBe('morgana');
      expect(normalizeForMatch('King Harold')).toBe('harold');
      expect(normalizeForMatch('Queen Elizabeth')).toBe('elizabeth');
      expect(normalizeForMatch('Sir Lancelot')).toBe('lancelot');
      expect(normalizeForMatch('Instructor Solsburn')).toBe('solsburn');
    });

    it('trims whitespace', () => {
      expect(normalizeForMatch('  System  ')).toBe('system');
    });

    it('handles multiple prefixes', () => {
      expect(normalizeForMatch('The Professor Smith')).toBe('smith');
    });

    it('handles names without prefixes', () => {
      expect(normalizeForMatch('Damien')).toBe('damien');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `normalizeForMatch` is not exported

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Code:
  ```typescript
  /** Prefixes to strip during normalization (order matters - check longer first) */
  const STRIP_PREFIXES = [
    'the ', 'a ', 'an ',
    'professor ', 'instructor ',
    'lord ', 'lady ', 'king ', 'queen ', 'prince ', 'princess ',
    'sir ', 'dame ', 'master ', 'mistress ',
    'grand warden ', 'commander ', 'captain ',
  ];

  /**
   * Normalize a name for matching:
   * 1. Trim whitespace
   * 2. Lowercase
   * 3. Strip common prefixes repeatedly until none match
   */
  export function normalizeForMatch(name: string): string {
    let normalized = name.trim().toLowerCase();

    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of STRIP_PREFIXES) {
        if (normalized.startsWith(prefix)) {
          normalized = normalized.slice(prefix.length);
          changed = true;
          break;
        }
      }
    }

    return normalized.trim();
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add normalizeForMatch function"`

---

## Task 4: Add `findMatchingEntry()` function

**Goal:** Implement the matching cascade logic.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  describe('findMatchingEntry', () => {
    const importedEntries: VoiceMappingEntry[] = [
      { name: 'The System', aliases: ['The System', 'System'], voice: 'en-US, MichelleNeural', gender: 'female' },
      { name: 'Cale Cadwell Cobbs', aliases: ['Cale Cadwell Cobbs', 'Cale'], voice: 'en-IE, ConnorNeural', gender: 'male' },
      { name: 'Professor Rinkle', aliases: ['Professor Rinkle'], voice: 'en-GB, LibbyNeural', gender: 'female' },
    ];

    it('matches by exact canonical name (case-insensitive)', () => {
      const char: LLMCharacter = { canonicalName: 'The System', variations: ['The System'], gender: 'female' };
      const match = findMatchingEntry(char, importedEntries);
      expect(match?.name).toBe('The System');
    });

    it('matches when current canonical is in imported aliases', () => {
      const char: LLMCharacter = { canonicalName: 'System', variations: ['System'], gender: 'female' };
      const match = findMatchingEntry(char, importedEntries);
      expect(match?.name).toBe('The System');
    });

    it('matches when current variation is in imported aliases', () => {
      const char: LLMCharacter = { canonicalName: 'The Protagonist', variations: ['The Protagonist', 'Cale'], gender: 'male' };
      const match = findMatchingEntry(char, importedEntries);
      expect(match?.name).toBe('Cale Cadwell Cobbs');
    });

    it('matches via normalized containment (word boundary)', () => {
      const char: LLMCharacter = { canonicalName: 'Rinkle', variations: ['Rinkle'], gender: 'female' };
      const match = findMatchingEntry(char, importedEntries);
      expect(match?.name).toBe('Professor Rinkle');
    });

    it('returns undefined when no match found', () => {
      const char: LLMCharacter = { canonicalName: 'Unknown Character', variations: ['Unknown Character'], gender: 'male' };
      const match = findMatchingEntry(char, importedEntries);
      expect(match).toBeUndefined();
    });

    it('handles entries without aliases (backward compat)', () => {
      const oldEntries: VoiceMappingEntry[] = [
        { name: 'The System', voice: 'en-US, MichelleNeural', gender: 'female' },
      ];
      const char: LLMCharacter = { canonicalName: 'The System', variations: ['The System'], gender: 'female' };
      const match = findMatchingEntry(char, oldEntries);
      expect(match?.name).toBe('The System');
    });

    it('does not match short substrings to avoid false positives', () => {
      const entries: VoiceMappingEntry[] = [
        { name: 'Joanna', aliases: ['Joanna'], voice: 'v1', gender: 'female' },
      ];
      const char: LLMCharacter = { canonicalName: 'Anna', variations: ['Anna'], gender: 'female' };
      const match = findMatchingEntry(char, entries);
      // "Anna" is in "Joanna" but not at word boundary - should not match
      expect(match).toBeUndefined();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `findMatchingEntry` is not exported

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Code:
  ```typescript
  /**
   * Check if normalized name A contains normalized name B at a word boundary.
   * Requires B to be at least 4 chars to avoid false positives.
   */
  function containsAtWordBoundary(haystack: string, needle: string): boolean {
    if (needle.length < 4) return false;

    const haystackWords = haystack.split(/\s+/);
    const needleWords = needle.split(/\s+/);

    // Check if all needle words appear in haystack words
    return needleWords.every(nw =>
      haystackWords.some(hw => hw === nw || hw.startsWith(nw) || nw.startsWith(hw))
    );
  }

  /**
   * Find matching imported entry for a character using cascade:
   * 1. Exact canonical name match (case-insensitive)
   * 2. Current canonical in imported aliases
   * 3. Any current variation in imported aliases
   * 4. Any imported alias in current variations
   * 5. Normalized containment at word boundary
   */
  export function findMatchingEntry(
    char: LLMCharacter,
    importedEntries: VoiceMappingEntry[]
  ): VoiceMappingEntry | undefined {
    const charCanonicalLower = char.canonicalName.toLowerCase();
    const charVariationsLower = char.variations.map(v => v.toLowerCase());
    const charNormalized = normalizeForMatch(char.canonicalName);
    const charVariationsNormalized = char.variations.map(normalizeForMatch);

    for (const entry of importedEntries) {
      const entryNameLower = entry.name.toLowerCase();
      const entryAliasesLower = (entry.aliases ?? [entry.name]).map(a => a.toLowerCase());
      const entryNormalized = normalizeForMatch(entry.name);
      const entryAliasesNormalized = (entry.aliases ?? [entry.name]).map(normalizeForMatch);

      // 1. Exact canonical match
      if (charCanonicalLower === entryNameLower) {
        return entry;
      }

      // 2. Current canonical in imported aliases
      if (entryAliasesLower.includes(charCanonicalLower)) {
        return entry;
      }

      // 3. Any current variation in imported aliases
      if (charVariationsLower.some(v => entryAliasesLower.includes(v))) {
        return entry;
      }

      // 4. Any imported alias in current variations
      if (entryAliasesLower.some(a => charVariationsLower.includes(a))) {
        return entry;
      }

      // 5. Normalized containment (word boundary)
      // Check if normalized char name/variations match entry name/aliases
      if (charNormalized === entryNormalized) {
        return entry;
      }
      if (charVariationsNormalized.some(v => v === entryNormalized)) {
        return entry;
      }
      if (entryAliasesNormalized.some(a => a === charNormalized)) {
        return entry;
      }
      if (entryAliasesNormalized.some(a => charVariationsNormalized.includes(a))) {
        return entry;
      }

      // Word boundary containment
      if (containsAtWordBoundary(entryNormalized, charNormalized) ||
          containsAtWordBoundary(charNormalized, entryNormalized)) {
        return entry;
      }
      for (const cv of charVariationsNormalized) {
        for (const ea of entryAliasesNormalized) {
          if (containsAtWordBoundary(ea, cv) || containsAtWordBoundary(cv, ea)) {
            return entry;
          }
        }
      }
    }

    return undefined;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add findMatchingEntry with cascade matching"`

---

## Task 5: Update `applyImportedMappings()` to use fuzzy matching

**Goal:** Replace exact matching with cascade matching.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  describe('applyImportedMappings with fuzzy matching', () => {
    it('matches by alias overlap when canonical names differ', () => {
      const importedEntries: VoiceMappingEntry[] = [
        { name: 'The System', aliases: ['The System', 'System'], voice: 'en-US, MichelleNeural', gender: 'female' },
      ];
      const currentCharacters: LLMCharacter[] = [
        { canonicalName: 'System', variations: ['System'], gender: 'female' },
      ];
      const currentVoiceMap = new Map<string, string>();

      const result = applyImportedMappings(importedEntries, currentCharacters, currentVoiceMap);

      expect(result.get('System')).toBe('en-US, MichelleNeural');
    });

    it('matches via normalized prefix stripping', () => {
      const importedEntries: VoiceMappingEntry[] = [
        { name: 'Professor Rinkle', aliases: ['Professor Rinkle'], voice: 'en-GB, LibbyNeural', gender: 'female' },
      ];
      const currentCharacters: LLMCharacter[] = [
        { canonicalName: 'Rinkle', variations: ['Rinkle'], gender: 'female' },
      ];
      const currentVoiceMap = new Map<string, string>();

      const result = applyImportedMappings(importedEntries, currentCharacters, currentVoiceMap);

      expect(result.get('Rinkle')).toBe('en-GB, LibbyNeural');
    });

    it('sets voice for all variations of matched character', () => {
      const importedEntries: VoiceMappingEntry[] = [
        { name: 'Cale Cadwell Cobbs', aliases: ['Cale Cadwell Cobbs', 'Cale'], voice: 'en-IE, ConnorNeural', gender: 'male' },
      ];
      const currentCharacters: LLMCharacter[] = [
        { canonicalName: 'Cale', variations: ['Cale', 'The Hero'], gender: 'male' },
      ];
      const currentVoiceMap = new Map<string, string>();

      const result = applyImportedMappings(importedEntries, currentCharacters, currentVoiceMap);

      expect(result.get('Cale')).toBe('en-IE, ConnorNeural');
      expect(result.get('The Hero')).toBe('en-IE, ConnorNeural');
    });

    it('preserves existing mappings for unmatched characters', () => {
      const importedEntries: VoiceMappingEntry[] = [
        { name: 'The System', aliases: ['The System'], voice: 'en-US, MichelleNeural', gender: 'female' },
      ];
      const currentCharacters: LLMCharacter[] = [
        { canonicalName: 'Unknown', variations: ['Unknown'], gender: 'male' },
      ];
      const currentVoiceMap = new Map([['Unknown', 'existing-voice']]);

      const result = applyImportedMappings(importedEntries, currentCharacters, currentVoiceMap);

      expect(result.get('Unknown')).toBe('existing-voice');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - fuzzy matching not working

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Action: Rewrite `applyImportedMappings()` to use `findMatchingEntry()`
- Code:
  ```typescript
  /**
   * Apply imported entries to existing characters and voice map.
   * Uses fuzzy matching cascade to find matches when canonical names differ.
   */
  export function applyImportedMappings(
    importedEntries: VoiceMappingEntry[],
    currentCharacters: LLMCharacter[],
    currentVoiceMap: Map<string, string>
  ): Map<string, string> {
    const newMap = new Map(currentVoiceMap);

    for (const char of currentCharacters) {
      const match = findMatchingEntry(char, importedEntries);
      if (match && match.voice) {
        newMap.set(char.canonicalName, match.voice);
        // Also update variations
        for (const variation of char.variations) {
          newMap.set(variation, match.voice);
        }
      }
    }

    return newMap;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): update applyImportedMappings to use fuzzy matching"`

---

## Task 6: Add debug logging for matches

**Goal:** Log match results for debugging.

**Step 1: Implementation**
- File: `src/services/VoiceMappingService.ts`
- Action: Add console.debug logs in `applyImportedMappings()` showing matches
- Code:
  ```typescript
  export function applyImportedMappings(...): Map<string, string> {
    const newMap = new Map(currentVoiceMap);

    for (const char of currentCharacters) {
      const match = findMatchingEntry(char, importedEntries);
      if (match && match.voice) {
        console.debug(`[VoiceMapping] Matched "${char.canonicalName}" → "${match.name}" (voice: ${match.voice})`);
        newMap.set(char.canonicalName, match.voice);
        for (const variation of char.variations) {
          newMap.set(variation, match.voice);
        }
      } else {
        console.debug(`[VoiceMapping] No match for "${char.canonicalName}"`);
      }
    }

    return newMap;
  }
  ```

**Step 2: Verify**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS (tests still pass)

**Step 3: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add debug logging for import matches"`

---

## Task 7: Run full test suite

**Goal:** Ensure no regressions.

**Step 1: Run all tests**
- Command: `npm test`
- Expect: All tests PASS

**Step 2: Run type check**
- Command: `npm run type-check`
- Expect: No errors

**Step 3: Git Commit (if any fixes needed)**
- Command: `git add . && git commit -m "fix(voice-mapping): address test/type issues"`
