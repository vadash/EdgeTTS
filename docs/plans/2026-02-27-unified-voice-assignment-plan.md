# Implementation Plan - Unified Voice Assignment with DRY Priority Pool

> **Reference:** `docs/designs/2026-02-27-unified-voice-assignment-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Make `pickVoice` Sequential (Fix Root Cause)

**Goal:** Change `VoicePoolTracker.pickVoice()` from random selection to sequential (first available), so pool ordering is respected.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceAllocator.test.ts`
- Code:
  ```typescript
  import { describe, expect, it } from 'vitest';
  import type { VoicePool } from '@/state/types';
  import { VoicePoolTracker } from './VoiceAllocator';

  describe('VoicePoolTracker', () => {
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, AndrewMultilingualNeural'],
      female: ['en-US, AvaNeural', 'en-US, JennyNeural'],
    };

    describe('pickVoice', () => {
      it('picks voices sequentially from pool (first available, not random)', () => {
        const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

        // Should always pick first available = AndrewNeural
        const first = tracker.pickVoice('male');
        expect(first).toBe('en-US, AndrewNeural');

        // Second pick should be BrianNeural (AndrewNeural now used)
        const second = tracker.pickVoice('male');
        expect(second).toBe('en-US, BrianNeural');

        // Third pick should be AndrewMultilingualNeural
        const third = tracker.pickVoice('male');
        expect(third).toBe('en-US, AndrewMultilingualNeural');
      });

      it('respects reserved voices when picking sequentially', () => {
        const reserved = new Set(['en-US, AndrewNeural']);
        const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural', reserved);

        // AndrewNeural is reserved, should skip to BrianNeural
        const first = tracker.pickVoice('male');
        expect(first).toBe('en-US, BrianNeural');
      });

      it('cycles through pool when exhausted', () => {
        const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

        // Exhaust female pool
        tracker.pickVoice('female'); // AvaNeural
        tracker.pickVoice('female'); // JennyNeural

        // Pool exhausted — should cycle from beginning
        const reused = tracker.pickVoice('female');
        expect(pool.female).toContain(reused);
      });

      it('narrator voice is always reserved', () => {
        const smallPool: VoicePool = {
          male: ['en-US, NarratorNeural', 'en-US, BrianNeural'],
          female: [],
        };
        const tracker = new VoicePoolTracker(smallPool, 'en-US, NarratorNeural');

        // Should skip narrator, pick BrianNeural
        const first = tracker.pickVoice('male');
        expect(first).toBe('en-US, BrianNeural');
      });
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: First test fails — `pickVoice` returns random voice, not necessarily `AndrewNeural`

**Step 3: Implementation (Green)**
- File: `src/services/VoiceAllocator.ts`
- Action: In `pickVoice()` method (line 72), change random selection to sequential:
  ```typescript
  // BEFORE:
  const voice = available[Math.floor(Math.random() * available.length)];

  // AFTER:
  const voice = available[0];
  ```
- Also change the fallback reuse (line 78) to use a cycle index:
  - Add private field: `private cycleCounters = { male: 0, female: 0 };`
  - Replace random fallback:
    ```typescript
    // BEFORE:
    return pool[Math.floor(Math.random() * pool.length)];

    // AFTER:
    const genderKey = gender === 'female' ? 'female' : 'male';
    const voice = pool[this.cycleCounters[genderKey] % pool.length];
    this.cycleCounters[genderKey]++;
    return voice;
    ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "fix: make VoicePoolTracker.pickVoice sequential to respect pool ordering"`

---

### Task 2: Add `buildPriorityPool` (Shared DRY Function)

**Goal:** Create a shared function that deduplicates + priority-orders voices, replacing `sortVoicesByPriority`.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceAllocator.test.ts`
- Code (append to existing file):
  ```typescript
  import { buildPriorityPool } from './VoiceAllocator';
  import type { VoiceOption } from '@/state/types';

  describe('buildPriorityPool', () => {
    const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
      const [locale, name] = fullValue.split(', ');
      return { locale, name, fullValue, gender };
    };

    it('deduplicates Multilingual pairs for EN book — keeps non-Multilingual', () => {
      const voices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, AndrewMultilingualNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
        vo('en-US, BrianMultilingualNeural', 'male'),
        vo('en-US, AriaNeural', 'female'),
      ];
      const result = buildPriorityPool(voices, 'en', new Set());

      const maleNames = result.male.map((v) => v.fullValue);
      expect(maleNames).toContain('en-US, AndrewNeural');
      expect(maleNames).not.toContain('en-US, AndrewMultilingualNeural');
      expect(maleNames).toContain('en-US, BrianNeural');
      expect(maleNames).not.toContain('en-US, BrianMultilingualNeural');
    });

    it('orders non-Multilingual before Multilingual', () => {
      const voices = [
        vo('ru-RU, DmitryNeural', 'male'),
        vo('en-US, AndrewMultilingualNeural', 'male'),
        vo('en-US, GuyNeural', 'male'),
      ];
      const result = buildPriorityPool(voices, 'ru', new Set());

      const maleNames = result.male.map((v) => v.fullValue);
      // DmitryNeural (native, non-multi) before AndrewMultilingualNeural
      expect(maleNames.indexOf('ru-RU, DmitryNeural')).toBeLessThan(
        maleNames.indexOf('en-US, AndrewMultilingualNeural'),
      );
    });

    it('excludes reserved voices', () => {
      const voices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
      ];
      const reserved = new Set(['en-US, AndrewNeural']);
      const result = buildPriorityPool(voices, 'en', reserved);

      const maleNames = result.male.map((v) => v.fullValue);
      expect(maleNames).not.toContain('en-US, AndrewNeural');
      expect(maleNames).toContain('en-US, BrianNeural');
    });

    it('returns empty pools for empty input', () => {
      const result = buildPriorityPool([], 'en', new Set());
      expect(result.male).toHaveLength(0);
      expect(result.female).toHaveLength(0);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: Fail — `buildPriorityPool` not found

**Step 3: Implementation (Green)**
- File: `src/services/VoiceAllocator.ts`
- Action: Add import and new function:
  ```typescript
  import { deduplicateVariants } from './VoicePoolBuilder';

  /**
   * Build a priority-ordered, deduplicated voice pool.
   * Used by all voice assignment paths (initial, randomize, JSON import).
   *
   * Order: native non-Multilingual → native Multilingual → foreign Multilingual
   * Dedup: variant pairs resolved (only one of Andrew/AndrewMultilingual survives)
   */
  export function buildPriorityPool(
    voices: VoiceOption[],
    bookLanguage: string,
    reserved: Set<string>,
  ): { male: VoiceOption[]; female: VoiceOption[] } {
    const available = voices.filter((v) => !reserved.has(v.fullValue));
    const deduped = deduplicateVariants(available, bookLanguage);
    return {
      male: deduped.filter((v) => v.gender === 'male'),
      female: deduped.filter((v) => v.gender === 'female'),
    };
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add buildPriorityPool shared DRY function for voice ordering"`

---

### Task 3: Wire `randomizeBelow` to Use `buildPriorityPool`

**Goal:** Replace `sortVoicesByPriority` usage in `randomizeBelow` with `buildPriorityPool`, adding dedup + multilingual-last ordering.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceAllocator.test.ts`
- Code (append):
  ```typescript
  import { randomizeBelow } from './VoiceAllocator';
  import type { LLMCharacter } from '@/state/types';

  describe('randomizeBelow', () => {
    const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
      const [locale, name] = fullValue.split(', ');
      return { locale, name, fullValue, gender };
    };

    const mkChar = (name: string, gender: 'male' | 'female' | 'unknown'): LLMCharacter => ({
      canonicalName: name,
      variations: [name],
      gender,
    });

    it('assigns native voices before Multilingual voices', () => {
      const chars = [
        mkChar('Alice', 'female'),  // index 0 — frozen
        mkChar('Bob', 'male'),      // index 1 — randomized
        mkChar('Charlie', 'male'),  // index 2 — randomized
        mkChar('Dave', 'male'),     // index 3 — randomized
      ];
      const currentMap = new Map([
        ['Alice', 'en-US, JennyNeural'],
        ['Bob', 'en-US, AndrewMultilingualNeural'],
        ['Charlie', 'en-US, BrianMultilingualNeural'],
        ['Dave', 'en-US, GuyNeural'],
      ]);
      const enabledVoices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, AndrewMultilingualNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
        vo('en-US, BrianMultilingualNeural', 'male'),
        vo('en-US, GuyNeural', 'male'),
        vo('en-US, JennyNeural', 'female'),
      ];

      const result = randomizeBelow(chars, currentMap, 0, enabledVoices, 'en-US, NarratorNeural', 'en');

      // Bob (index 1) should get a native voice, not a Multilingual one
      const bobVoice = result.get('Bob')!;
      expect(bobVoice).not.toContain('Multilingual');

      // All non-Multilingual male voices should be used before any Multilingual
      const assignedMales = [result.get('Bob')!, result.get('Charlie')!, result.get('Dave')!];
      const firstMultiIdx = assignedMales.findIndex((v) => v.includes('Multilingual'));
      const lastNativeIdx = assignedMales.reduce(
        (last, v, i) => (!v.includes('Multilingual') ? i : last), -1
      );
      if (firstMultiIdx !== -1 && lastNativeIdx !== -1) {
        expect(lastNativeIdx).toBeLessThan(firstMultiIdx);
      }
    });

    it('deduplicates variant pairs — never assigns both Andrew and AndrewMultilingual', () => {
      const chars = [
        mkChar('Bob', 'male'),
        mkChar('Charlie', 'male'),
      ];
      const currentMap = new Map<string, string>();
      const enabledVoices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, AndrewMultilingualNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
      ];

      const result = randomizeBelow(chars, currentMap, -1, enabledVoices, 'en-US, NarratorNeural', 'en');

      const assignedVoices = [...result.values()];
      const hasAndrew = assignedVoices.includes('en-US, AndrewNeural');
      const hasAndrewMulti = assignedVoices.includes('en-US, AndrewMultilingualNeural');
      // At most one of the pair should be assigned
      expect(hasAndrew && hasAndrewMulti).toBe(false);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: Fails — `randomizeBelow` uses `sortVoicesByPriority` which doesn't dedup

**Step 3: Implementation (Green)**
- File: `src/services/VoiceAllocator.ts`
- Action: In `randomizeBelow()` function (around line 280), replace `sortVoicesByPriority` call with `buildPriorityPool`:
  ```typescript
  // BEFORE:
  const prioritized = sortVoicesByPriority(enabledVoices, bookLanguage, narratorVoice);
  const malePool = prioritized.filter((v) => v.gender === 'male' && !reserved.has(v.fullValue));
  const femalePool = prioritized.filter((v) => v.gender === 'female' && !reserved.has(v.fullValue));

  // AFTER:
  const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);
  const malePool = pool.male;
  const femalePool = pool.female;
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "fix: randomizeBelow uses buildPriorityPool for dedup + ordering"`

---

### Task 4: Fix JSON Import — Reassign Unmatched Characters from Priority Pool

**Goal:** After JSON import, unmatched characters and characters with invalid (non-enabled) voices get reassigned via the priority pool.

**Step 1: Write the Failing Test**
- File: `src/services/VoiceAllocator.test.ts`
- Code (append):
  ```typescript
  import { assignUnmatchedFromPool } from './VoiceAllocator';

  describe('assignUnmatchedFromPool', () => {
    const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
      const [locale, name] = fullValue.split(', ');
      return { locale, name, fullValue, gender };
    };

    const mkChar = (name: string, gender: 'male' | 'female' | 'unknown'): LLMCharacter => ({
      canonicalName: name,
      variations: [name],
      gender,
    });

    it('assigns unmatched characters from priority pool sequentially', () => {
      const chars = [
        mkChar('Alice', 'female'),
        mkChar('Bob', 'male'),
        mkChar('Charlie', 'male'),
      ];
      const importedMap = new Map([
        ['Alice', 'en-US, JennyNeural'],
        // Bob and Charlie are unmatched
      ]);
      const enabledVoices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
        vo('en-US, JennyNeural', 'female'),
      ];

      const result = assignUnmatchedFromPool(
        chars,
        importedMap,
        enabledVoices,
        'en-US, NarratorNeural',
        'en',
      );

      expect(result.get('Alice')).toBe('en-US, JennyNeural'); // preserved
      expect(result.get('Bob')).toBe('en-US, AndrewNeural');   // first available male
      expect(result.get('Charlie')).toBe('en-US, BrianNeural'); // second available male
    });

    it('replaces imported voices not in enabled list', () => {
      const chars = [
        mkChar('Alice', 'female'),
      ];
      const importedMap = new Map([
        ['Alice', 'de-DE, KatjaNeural'], // not in enabled list
      ]);
      const enabledVoices = [
        vo('en-US, JennyNeural', 'female'),
        vo('en-US, AriaNeural', 'female'),
      ];

      const result = assignUnmatchedFromPool(
        chars,
        importedMap,
        enabledVoices,
        'en-US, NarratorNeural',
        'en',
      );

      // Alice's voice should be replaced with an enabled voice
      expect(result.get('Alice')).toBe('en-US, JennyNeural');
    });

    it('deduplicates Multilingual pairs in assignment', () => {
      const chars = [
        mkChar('Bob', 'male'),
        mkChar('Charlie', 'male'),
      ];
      const importedMap = new Map<string, string>(); // all unmatched
      const enabledVoices = [
        vo('en-US, AndrewNeural', 'male'),
        vo('en-US, AndrewMultilingualNeural', 'male'),
        vo('en-US, BrianNeural', 'male'),
      ];

      const result = assignUnmatchedFromPool(
        chars,
        importedMap,
        enabledVoices,
        'en-US, NarratorNeural',
        'en',
      );

      const assignedVoices = [...result.values()];
      const hasAndrew = assignedVoices.includes('en-US, AndrewNeural');
      const hasAndrewMulti = assignedVoices.includes('en-US, AndrewMultilingualNeural');
      expect(hasAndrew && hasAndrewMulti).toBe(false);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: Fail — `assignUnmatchedFromPool` not found

**Step 3: Implementation (Green)**
- File: `src/services/VoiceAllocator.ts`
- Action: Add new exported function:
  ```typescript
  /**
   * Assign voices to unmatched characters from priority pool.
   * Used after JSON import to fill gaps.
   *
   * - Characters in importedMap with valid (enabled) voices are preserved
   * - Characters with invalid voices or missing from importedMap get assigned from pool
   * - Uses buildPriorityPool for dedup + ordering
   */
  export function assignUnmatchedFromPool(
    characters: LLMCharacter[],
    importedMap: Map<string, string>,
    enabledVoices: VoiceOption[],
    narratorVoice: string,
    bookLanguage: string,
  ): Map<string, string> {
    const enabledSet = new Set(enabledVoices.map((v) => v.fullValue));
    const result = new Map<string, string>();
    const reserved = new Set<string>([narratorVoice]);

    // First pass: collect valid imported voices
    for (const char of characters) {
      const imported = importedMap.get(char.canonicalName);
      if (imported && enabledSet.has(imported)) {
        result.set(char.canonicalName, imported);
        reserved.add(imported);
      }
    }

    // Build priority pool excluding reserved voices
    const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);

    // Second pass: assign unmatched characters
    const malePool = pool.male;
    const femalePool = pool.female;
    let maleIdx = 0;
    let femaleIdx = 0;

    for (const char of characters) {
      if (result.has(char.canonicalName)) continue; // already assigned

      const genderPool =
        char.gender === 'female' && femalePool.length > 0
          ? femalePool
          : malePool.length > 0
            ? malePool
            : femalePool;

      const idx = char.gender === 'female' && femalePool.length > 0 ? femaleIdx++ : maleIdx++;

      if (genderPool.length > 0) {
        result.set(char.canonicalName, genderPool[idx % genderPool.length].fullValue);
      }
    }

    return result;
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/VoiceAllocator.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add assignUnmatchedFromPool for JSON import voice assignment"`

---

### Task 5: Wire VoiceReviewModal to Use `assignUnmatchedFromPool`

**Goal:** Update `handleImportFile` in VoiceReviewModal to validate imported voices and reassign unmatched characters.

**Step 1: No Unit Test** (UI wiring — verified manually + existing integration)

**Step 2: Implementation**
- File: `src/components/convert/VoiceReviewModal.tsx`
- Action: Update the import and `handleImportFile` function:

  1. Add import:
     ```typescript
     import { assignUnmatchedFromPool } from '@/services/VoiceAllocator';
     ```

  2. Replace the merge logic in `handleImportFile` (lines 117-121):
     ```typescript
     // BEFORE:
     // Merge imported voices into current map
     const newMap = new Map(voiceMap);
     for (const [name, voice] of importedMap) {
       newMap.set(name, voice);
     }
     llm.setVoiceMap(newMap);

     // AFTER:
     // Reassign unmatched + invalid voices from priority pool
     const enabledVoiceOptions = voices.filter((v) => enabledVoices.includes(v.fullValue));
     const newMap = assignUnmatchedFromPool(
       sortedCharacters,
       importedMap,
       enabledVoiceOptions,
       settings.voice.value,
       data.detectedLanguage.value,
     );
     llm.setVoiceMap(newMap);
     ```

  3. Update the log message to include replaced count:
     ```typescript
     // Count how many imported voices were not in enabled list
     const enabledSet = new Set(enabledVoices);
     const replacedCount = [...importedMap.values()].filter(
       (v) => !enabledSet.has(v),
     ).length;
     const matchCount = matchedCharacters.size - replacedCount;
     const unmatchCount = unmatchedCharacters.length + replacedCount;
     logs.info(
       `Imported voices: ${matchCount} matched, ${unmatchCount} reassigned from ${file.name}`,
     );
     ```

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: All existing tests pass (no regressions)

**Step 4: Git Commit**
- Command: `git add . && git commit -m "fix: VoiceReviewModal JSON import reassigns unmatched via priority pool"`

---

### Task 6: Delete `sortVoicesByPriority` (Dead Code)

**Goal:** Remove the now-unused `sortVoicesByPriority` function.

**Step 1: Verify No Remaining References**
- Command: Search codebase for `sortVoicesByPriority` — should only appear in its own definition + this plan file

**Step 2: Implementation**
- File: `src/services/VoiceAllocator.ts`
- Action: Delete the `sortVoicesByPriority` function (lines 281-300) and remove its export from anywhere it's exported.
- File: `src/services/llm/VoiceProfile.ts`
- Action: If `VoiceProfile.ts` re-exports or imports `sortVoicesByPriority`, remove that import/export.

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: All tests pass

**Step 4: Git Commit**
- Command: `git add . && git commit -m "refactor: delete sortVoicesByPriority, replaced by buildPriorityPool"`

---

### Task 7: Run Full Test Suite + Verify Design Compliance

**Goal:** Confirm all 3 paths use the shared algorithm and all tests pass.

**Step 1: Run Full Suite**
- Command: `npx vitest run`
- Expect: All tests pass

**Step 2: Verify DRY Compliance**
- Search for `Math.random()` in `VoiceAllocator.ts` — should find **zero** occurrences (removed from `pickVoice`)
- Search for `sortVoicesByPriority` in entire codebase — should find **zero** occurrences
- Search for `deduplicateVariants` usage — should be called from `buildVoicePool` AND `buildPriorityPool` (both paths)

**Step 3: Git Commit**
- Command: `git add . && git commit -m "docs: complete unified voice assignment implementation"`
