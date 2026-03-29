# Pre-Merge Frequency Culling Implementation Plan

**Goal:** Filter hallucinated/noise characters by text-mention frequency before the expensive LLM merge step.
**Architecture:** Add a pure function `cullByFrequency` to `CharacterUtils.ts` that counts how many times each character's name variations appear in the raw text, then cull those below threshold 3. Integrate it into `LLMVoiceService.extractCharacters()` after simple merge and before LLM merge.
**Tech Stack:** TypeScript, Vitest

---

### File Structure Overview

- **Create:** `src/services/llm/CharacterUtils.test.ts` — unit tests for `cullByFrequency`
- **Modify:** `src/services/llm/CharacterUtils.ts` — add `cullByFrequency` export
- **Modify:** `src/services/llm/LLMVoiceService.ts` — call `cullByFrequency` in `extractCharacters()`

---

### Task 1: Write failing tests for cullByFrequency

**Files:**
- Create: `src/services/llm/CharacterUtils.test.ts`

- [ ] Step 1: Write the failing test

```typescript
import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { cullByFrequency } from './CharacterUtils';

function makeChar(name: string, variations: string[], gender: 'male' | 'female' | 'unknown' = 'unknown'): LLMCharacter {
  return { canonicalName: name, variations, gender };
}

describe('cullByFrequency', () => {
  it('culled characters below threshold, keeps characters above', () => {
    const text = 'Alice said hello. Alice went home. Alice slept. Bob was never mentioned anywhere.';
    const characters = [
      makeChar('Alice', ['Alice']),
      makeChar('Bob', ['Bob']),
    ];

    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Alice');
  });

  it('sums mentions across all variations', () => {
    const text = 'Catherine fought. Cat won. Catherine Foundling returned. Cat slept. Catherine smiled.';
    const characters = [
      makeChar('Catherine', ['Catherine', 'Cat', 'Catherine Foundling']),
    ];

    // Catherine=3, Cat=2, "Catherine Foundling"=1 → total=6
    const result = cullByFrequency(characters, text.toLowerCase(), 5);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Catherine');
  });

  it('skips variations shorter than 3 characters', () => {
    const text = 'I went there. I came back. I saw. me too. I know.';
    const characters = [
      makeChar('Protagonist', ['I', 'me', 'my']),
    ];

    // "I" (1 char), "me" (2 chars), "my" (2 chars) all skipped → 0 mentions
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(0);
  });

  it('keeps character at exact threshold (inclusive)', () => {
    const text = 'Hakram nodded. Hakram smiled. Hakram left.';
    const characters = [
      makeChar('Hakram', ['Hakram']),
    ];

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
    const characters = [
      makeChar('Alice', ['Alice']),
    ];

    const result = cullByFrequency(characters, '', 1);

    expect(result).toEqual([]);
  });

  it('returns all characters when all are above threshold', () => {
    const text = 'Alice and Bob sat. Alice spoke. Bob replied. Alice nodded. Bob agreed.';
    const characters = [
      makeChar('Alice', ['Alice']),
      makeChar('Bob', ['Bob']),
    ];

    // Alice=3, Bob=3
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(2);
  });

  it('matches case-insensitively', () => {
    const text = 'catherine walked. CATHERINE ran. CatHerIne jumped.';
    const characters = [
      makeChar('Catherine', ['Catherine']),
    ];

    // The function receives lowercased text and lowercases variations internally
    const result = cullByFrequency(characters, text.toLowerCase(), 3);

    expect(result).toHaveLength(1);
  });

  it('uses default threshold of 3', () => {
    const text = 'Alice appeared once.';
    const characters = [
      makeChar('Alice', ['Alice']),
    ];

    // Alice mentioned 1 time, default threshold is 3
    const result = cullByFrequency(characters, text.toLowerCase());

    expect(result).toHaveLength(0);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/llm/CharacterUtils.test.ts`
Expected: FAIL — `cullByFrequency` is not exported from `CharacterUtils.ts`

---

### Task 2: Implement cullByFrequency

**Files:**
- Modify: `src/services/llm/CharacterUtils.ts`

- [ ] Step 1: Write the implementation

Add the following export at the end of `src/services/llm/CharacterUtils.ts` (after the existing `countSpeakingFrequency` function, before the closing of the file):

```typescript
/**
 * Cull characters whose name variations appear fewer than threshold times in the text.
 * Removes hallucinated and ultra-minor characters before the expensive LLM merge step.
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

      const needle = variation.toLowerCase();
      let pos = 0;

      while (true) {
        pos = fullText.indexOf(needle, pos);
        if (pos >= 0) {
          totalMentions++;
          pos += needle.length;
        } else {
          break;
        }
      }
    }

    return totalMentions >= threshold;
  });
}
```

- [ ] Step 2: Run tests to verify they pass

Run: `npx vitest run src/services/llm/CharacterUtils.test.ts`
Expected: All 9 tests PASS

- [ ] Step 3: Commit

```bash
git add src/services/llm/CharacterUtils.ts src/services/llm/CharacterUtils.test.ts
git commit -m "feat: add cullByFrequency to filter noise characters by text-mention count"
```

---

### Task 3: Integrate cullByFrequency into extractCharacters

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

**Common Pitfalls:**
- `fullText` must be constructed from `blocks` (available in scope), not from `allCharacters`
- The text must be `.toLowerCase()` before passing to `cullByFrequency`
- Import `cullByFrequency` alongside the existing `mergeCharacters` import

- [ ] Step 1: Update the import line in `LLMVoiceService.ts`

Current line (around line 10):
```typescript
import { applyMergeGroups, buildCodeMapping, mergeCharacters } from './CharacterUtils';
```

Change to:
```typescript
import { applyMergeGroups, buildCodeMapping, cullByFrequency, mergeCharacters } from './CharacterUtils';
```

- [ ] Step 2: Add culling logic in `extractCharacters()` after simple merge

Current code (around lines 247-252):
```typescript
    // Simple merge by canonicalName
    let merged = mergeCharacters(allCharacters);

    // LLM merge if multiple blocks and characters
    if (blocks.length > 1 && merged.length > 1) {
```

Change to:
```typescript
    // Simple merge by canonicalName
    let merged = mergeCharacters(allCharacters);

    // Pre-merge frequency culling (remove hallucinated/noise characters)
    const fullText = blocks
      .map(b => b.sentences.join('\n'))
      .join('\n')
      .toLowerCase();
    const beforeCull = merged.length;
    merged = cullByFrequency(merged, fullText);
    this.logger?.info(
      `[Extract] Culled ${beforeCull - merged.length}/${beforeCull} characters by frequency. Remaining: ${merged.length}`,
    );

    // LLM merge if multiple blocks and characters
    if (blocks.length > 1 && merged.length > 1) {
```

- [ ] Step 3: Run all existing LLM tests to verify nothing breaks

Run: `npx vitest run src/services/llm/`
Expected: All tests PASS (including the new `CharacterUtils.test.ts` and existing `merge.test.ts`, `votingConsensus.test.ts`, etc.)

- [ ] Step 4: Commit

```bash
git add src/services/llm/LLMVoiceService.ts
git commit -m "feat: integrate cullByFrequency into extractCharacters pipeline"
```
