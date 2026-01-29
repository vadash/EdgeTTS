# Implementation Plan - Randomize Below Voices

> **Reference:** `docs/designs/2026-01-29-randomize-below-voices-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add `sortVoicesByPriority` helper

**Goal:** Create a function that sorts voices by book language, then rest alphabetically.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { sortVoicesByPriority } from './VoiceMappingService';
  import type { VoiceOption } from '@/state/types';

  describe('sortVoicesByPriority', () => {
    const voices: VoiceOption[] = [
      { locale: 'de-DE', name: 'ConradNeural', fullValue: 'de-DE, ConradNeural', gender: 'male' },
      { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
      { locale: 'ru-RU', name: 'DmitryNeural', fullValue: 'ru-RU, DmitryNeural', gender: 'male' },
      { locale: 'en-GB', name: 'RyanNeural', fullValue: 'en-GB, RyanNeural', gender: 'male' },
    ];

    it('puts book language voices first for English book', () => {
      const sorted = sortVoicesByPriority(voices, 'en', 'de-DE, ConradNeural');
      expect(sorted[0].locale).toBe('en-US');
      expect(sorted[1].locale).toBe('en-GB');
    });

    it('puts book language voices first for Russian book', () => {
      const sorted = sortVoicesByPriority(voices, 'ru', 'de-DE, ConradNeural');
      expect(sorted[0].locale).toBe('ru-RU');
    });

    it('excludes narrator voice from the list', () => {
      const sorted = sortVoicesByPriority(voices, 'en', 'en-US, GuyNeural');
      expect(sorted.find(v => v.fullValue === 'en-US, GuyNeural')).toBeUndefined();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `sortVoicesByPriority` not exported

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Action: Add at end of file:
  ```typescript
  import type { DetectedLanguage } from '@/utils/languageDetection';

  /**
   * Sorts voices by priority for randomization
   * Priority: book language voices first, then rest alphabetically
   * Excludes narrator voice from the result
   */
  export function sortVoicesByPriority(
    voices: VoiceOption[],
    bookLanguage: DetectedLanguage,
    narratorVoice: string
  ): VoiceOption[] {
    // Filter out narrator voice
    const filtered = voices.filter(v => v.fullValue !== narratorVoice);

    // Language prefix to match (e.g., 'en' matches 'en-US', 'en-GB')
    const langPrefix = bookLanguage === 'ru' ? 'ru' : 'en';

    // Separate into book language and other
    const bookLangVoices: VoiceOption[] = [];
    const otherVoices: VoiceOption[] = [];

    for (const voice of filtered) {
      if (voice.locale.startsWith(langPrefix)) {
        bookLangVoices.push(voice);
      } else {
        otherVoices.push(voice);
      }
    }

    // Sort each group alphabetically by fullValue
    bookLangVoices.sort((a, b) => a.fullValue.localeCompare(b.fullValue));
    otherVoices.sort((a, b) => a.fullValue.localeCompare(b.fullValue));

    return [...bookLangVoices, ...otherVoices];
  }
  ```
- Note: Also add `VoiceOption` to existing imports from `@/state/types`.

**Step 4: Verify (Green)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add sortVoicesByPriority helper"`

---

## Task 2: Add `RandomizeBelowParams` interface

**Goal:** Define the input interface for the randomize function.

**Step 1: Implementation**
- File: `src/services/VoiceMappingService.ts`
- Action: Add interface after existing interfaces:
  ```typescript
  /**
   * Parameters for randomizeBelowVoices function
   */
  export interface RandomizeBelowParams {
    /** Characters sorted by line count (descending) */
    sortedCharacters: LLMCharacter[];
    /** Current voice assignments */
    currentVoiceMap: Map<string, string>;
    /** Index of row where button clicked (randomize BELOW this) */
    clickedIndex: number;
    /** All enabled voices */
    enabledVoices: VoiceOption[];
    /** Narrator voice to reserve */
    narratorVoice: string;
    /** Detected book language */
    bookLanguage: DetectedLanguage;
  }
  ```
- Note: Add `LLMCharacter` to imports from `@/state/types`.

**Step 2: Verify**
- Command: `npm run type-check`
- Expect: No errors

**Step 3: Git Commit**
- Command: `git add . && git commit -m "feat(voice-mapping): add RandomizeBelowParams interface"`

---

## Task 3: Add `randomizeBelowVoices` function - basic case

**Goal:** Implement the core randomization logic for simple case (enough voices).

**Step 1: Write the Failing Test**
- File: `src/services/VoiceMappingService.test.ts`
- Code: Add to existing describe block:
  ```typescript
  import { randomizeBelowVoices, type RandomizeBelowParams } from './VoiceMappingService';
  import type { LLMCharacter } from '@/state/types';

  describe('randomizeBelowVoices', () => {
    const maleVoices: VoiceOption[] = [
      { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
      { locale: 'en-US', name: 'DavisNeural', fullValue: 'en-US, DavisNeural', gender: 'male' },
      { locale: 'en-US', name: 'TonyNeural', fullValue: 'en-US, TonyNeural', gender: 'male' },
    ];
    const femaleVoices: VoiceOption[] = [
      { locale: 'en-US', name: 'JennyNeural', fullValue: 'en-US, JennyNeural', gender: 'female' },
      { locale: 'en-US', name: 'AriaNeural', fullValue: 'en-US, AriaNeural', gender: 'female' },
    ];
    const allVoices = [...maleVoices, ...femaleVoices];

    const characters: LLMCharacter[] = [
      { canonicalName: 'Narrator', variations: [], gender: 'male' },
      { canonicalName: 'Alice', variations: [], gender: 'female' },
      { canonicalName: 'Bob', variations: [], gender: 'male' },
      { canonicalName: 'Carol', variations: [], gender: 'female' },
    ];

    it('randomizes voices for characters below clicked index', () => {
      const currentMap = new Map([
        ['Narrator', 'en-US, GuyNeural'],
        ['Alice', 'en-US, JennyNeural'],
        ['Bob', 'en-US, GuyNeural'],  // duplicate - will be randomized
        ['Carol', 'en-US, GuyNeural'], // duplicate - will be randomized
      ]);

      const params: RandomizeBelowParams = {
        sortedCharacters: characters,
        currentVoiceMap: currentMap,
        clickedIndex: 1, // Click on Alice, randomize Bob and Carol
        enabledVoices: allVoices,
        narratorVoice: 'en-US, GuyNeural',
        bookLanguage: 'en',
      };

      const result = randomizeBelowVoices(params);

      // Narrator and Alice should be unchanged
      expect(result.get('Narrator')).toBe('en-US, GuyNeural');
      expect(result.get('Alice')).toBe('en-US, JennyNeural');

      // Bob should get a male voice (not GuyNeural - reserved by Narrator, not JennyNeural - reserved by Alice)
      const bobVoice = result.get('Bob');
      expect(bobVoice).toBeDefined();
      expect(['en-US, DavisNeural', 'en-US, TonyNeural']).toContain(bobVoice);

      // Carol should get a female voice (not JennyNeural - reserved by Alice)
      const carolVoice = result.get('Carol');
      expect(carolVoice).toBe('en-US, AriaNeural');
    });

    it('preserves voices above clicked index', () => {
      const currentMap = new Map([
        ['Narrator', 'en-US, GuyNeural'],
        ['Alice', 'en-US, JennyNeural'],
        ['Bob', 'en-US, DavisNeural'],
        ['Carol', 'en-US, AriaNeural'],
      ]);

      const params: RandomizeBelowParams = {
        sortedCharacters: characters,
        currentVoiceMap: currentMap,
        clickedIndex: 2, // Click on Bob, only Carol randomized
        enabledVoices: allVoices,
        narratorVoice: 'en-US, TonyNeural',
        bookLanguage: 'en',
      };

      const result = randomizeBelowVoices(params);

      expect(result.get('Narrator')).toBe('en-US, GuyNeural');
      expect(result.get('Alice')).toBe('en-US, JennyNeural');
      expect(result.get('Bob')).toBe('en-US, DavisNeural');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: Fail - `randomizeBelowVoices` not exported

**Step 3: Implementation (Green)**
- File: `src/services/VoiceMappingService.ts`
- Action: Add function:
  ```typescript
  /**
   * Randomizes voice assignments for characters below a given index
   *
   * Algorithm:
   * 1. Collect voices assigned to characters at indices 0..clickedIndex (reserved)
   * 2. Add narrator voice to reserved set
   * 3. Filter enabled voices: remove reserved, sort by priority
   * 4. For each character below clickedIndex:
   *    - Filter voices by matching gender
   *    - Pick next voice from filtered pool (cycle if exhausted)
   * 5. Return new voice map
   */
  export function randomizeBelowVoices(params: RandomizeBelowParams): Map<string, string> {
    const {
      sortedCharacters,
      currentVoiceMap,
      clickedIndex,
      enabledVoices,
      narratorVoice,
      bookLanguage,
    } = params;

    // Start with copy of current map
    const newMap = new Map(currentVoiceMap);

    // Nothing to do if clicked on last item
    if (clickedIndex >= sortedCharacters.length - 1) {
      return newMap;
    }

    // Collect reserved voices (from characters at/above clicked index + narrator)
    const reservedVoices = new Set<string>();
    reservedVoices.add(narratorVoice);
    for (let i = 0; i <= clickedIndex; i++) {
      const charName = sortedCharacters[i].canonicalName;
      const voice = currentVoiceMap.get(charName);
      if (voice) {
        reservedVoices.add(voice);
      }
    }

    // Get sorted available voices (excluding narrator)
    const sortedVoices = sortVoicesByPriority(enabledVoices, bookLanguage, narratorVoice);

    // Split by gender
    const availableMale = sortedVoices.filter(v => v.gender === 'male' && !reservedVoices.has(v.fullValue));
    const availableFemale = sortedVoices.filter(v => v.gender === 'female' && !reservedVoices.has(v.fullValue));

    // Track indices for cycling
    let maleIndex = 0;
    let femaleIndex = 0;

    // Assign voices to characters below clicked index
    for (let i = clickedIndex + 1; i < sortedCharacters.length; i++) {
      const char = sortedCharacters[i];
      let pool: VoiceOption[];
      let poolIndex: number;

      if (char.gender === 'female') {
        pool = availableFemale.length > 0 ? availableFemale : availableMale;
        poolIndex = char.gender === 'female' && availableFemale.length > 0 ? femaleIndex : maleIndex;
      } else {
        // male or unknown -> use male pool
        pool = availableMale.length > 0 ? availableMale : availableFemale;
        poolIndex = availableMale.length > 0 ? maleIndex : femaleIndex;
      }

      if (pool.length > 0) {
        const voice = pool[poolIndex % pool.length];
        newMap.set(char.canonicalName, voice.fullValue);

        // Increment correct index
        if (char.gender === 'female' && availableFemale.length > 0) {
          femaleIndex++;
        } else {
          maleIndex++;
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
- Command: `git add . && git commit -m "feat(voice-mapping): add randomizeBelowVoices function"`

---

## Task 4: Test edge cases - cycling and empty pools

**Goal:** Add tests for round-robin cycling and gender fallback.

**Step 1: Write the Tests**
- File: `src/services/VoiceMappingService.test.ts`
- Code: Add to `randomizeBelowVoices` describe block:
  ```typescript
    it('cycles through voices when more characters than voices', () => {
      const limitedVoices: VoiceOption[] = [
        { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
        { locale: 'en-US', name: 'DavisNeural', fullValue: 'en-US, DavisNeural', gender: 'male' },
      ];

      const manyMaleChars: LLMCharacter[] = [
        { canonicalName: 'Alice', variations: [], gender: 'female' },
        { canonicalName: 'Bob', variations: [], gender: 'male' },
        { canonicalName: 'Charlie', variations: [], gender: 'male' },
        { canonicalName: 'Dan', variations: [], gender: 'male' },
        { canonicalName: 'Eve', variations: [], gender: 'male' },
      ];

      const currentMap = new Map([['Alice', 'en-US, JennyNeural']]);

      const params: RandomizeBelowParams = {
        sortedCharacters: manyMaleChars,
        currentVoiceMap: currentMap,
        clickedIndex: 0,
        enabledVoices: limitedVoices,
        narratorVoice: 'other-voice',
        bookLanguage: 'en',
      };

      const result = randomizeBelowVoices(params);

      // Should cycle: Guy, Davis, Guy, Davis
      expect(result.get('Bob')).toBe('en-US, GuyNeural');
      expect(result.get('Charlie')).toBe('en-US, DavisNeural');
      expect(result.get('Dan')).toBe('en-US, GuyNeural');
      expect(result.get('Eve')).toBe('en-US, DavisNeural');
    });

    it('falls back to other gender when pool is empty', () => {
      const onlyMaleVoices: VoiceOption[] = [
        { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
      ];

      const femaleChar: LLMCharacter[] = [
        { canonicalName: 'Narrator', variations: [], gender: 'male' },
        { canonicalName: 'Alice', variations: [], gender: 'female' },
      ];

      const currentMap = new Map([['Narrator', 'other-voice']]);

      const params: RandomizeBelowParams = {
        sortedCharacters: femaleChar,
        currentVoiceMap: currentMap,
        clickedIndex: 0,
        enabledVoices: onlyMaleVoices,
        narratorVoice: 'other-voice',
        bookLanguage: 'en',
      };

      const result = randomizeBelowVoices(params);

      // Female Alice gets male voice since no female voices available
      expect(result.get('Alice')).toBe('en-US, GuyNeural');
    });

    it('does nothing when clicked on last row', () => {
      const currentMap = new Map([
        ['Narrator', 'en-US, GuyNeural'],
        ['Alice', 'en-US, JennyNeural'],
      ]);

      const params: RandomizeBelowParams = {
        sortedCharacters: characters.slice(0, 2),
        currentVoiceMap: currentMap,
        clickedIndex: 1, // Last index
        enabledVoices: allVoices,
        narratorVoice: 'other-voice',
        bookLanguage: 'en',
      };

      const result = randomizeBelowVoices(params);

      expect(result.get('Narrator')).toBe('en-US, GuyNeural');
      expect(result.get('Alice')).toBe('en-US, JennyNeural');
    });
  ```

**Step 2: Run Tests**
- Command: `npm test src/services/VoiceMappingService.test.ts`
- Expect: PASS (all edge cases handled by existing implementation)

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test(voice-mapping): add edge case tests for randomizeBelowVoices"`

---

## Task 5: Add randomize button to VoiceReviewModal

**Goal:** Add 🎲↓ button to each character row.

**Step 1: Implementation**
- File: `src/components/convert/VoiceReviewModal.tsx`
- Action 1: Add imports at top:
  ```typescript
  import { randomizeBelowVoices } from '@/services/VoiceMappingService';
  import { useData } from '@/stores';
  import voices from '@/components/VoiceSelector/voices';
  ```
- Action 2: Add `data` store hook inside component:
  ```typescript
  const data = useData();
  ```
- Action 3: Add handler function after existing handlers:
  ```typescript
  const handleRandomizeBelow = (clickedIndex: number) => {
    const enabledVoiceOptions = voices.filter(v => enabledVoices.includes(v.fullValue));
    const newMap = randomizeBelowVoices({
      sortedCharacters,
      currentVoiceMap: voiceMap,
      clickedIndex,
      enabledVoices: enabledVoiceOptions,
      narratorVoice: settings.voice.value,
      bookLanguage: data.detectedLanguage.value,
    });
    llm.setVoiceMap(newMap);
  };
  ```
- Action 4: Add button in table row, after the preview button `<td>`:
  ```tsx
  <td className="py-2">
    <button
      className="btn btn-sm px-2"
      onClick={() => handleRandomizeBelow(index)}
      title="Randomize voices below"
    >
      🎲↓
    </button>
  </td>
  ```
- Note: Need to track `index` in the map. Change:
  ```tsx
  {sortedCharacters.map((char) => {
  ```
  To:
  ```tsx
  {sortedCharacters.map((char, index) => {
  ```

**Step 2: Verify**
- Command: `npm run type-check`
- Expect: No errors

**Step 3: Manual Test**
- Command: `npm run dev`
- Test: Load a book with LLM voice detection, open Voice Review, click 🎲↓ button on a row, verify voices below are randomized.

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat(voice-review): add randomize below button"`

---

## Task 6: Final verification

**Goal:** Run full test suite and type-check.

**Step 1: Run All Tests**
- Command: `npm run test`
- Expect: All tests pass

**Step 2: Type Check**
- Command: `npm run type-check`
- Expect: No errors

**Step 3: Git Commit (if any fixes needed)**
- Command: `git add . && git commit -m "fix: address test/type issues"`
