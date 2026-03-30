# Prompt Rules Refinement Implementation Plan

**Goal:** Refine LLM prompt rules to fix logical contradictions and blind spots in extraction, merge, and QA stages.

**Architecture:** Simple text-based changes to prompt constants and minimal code modifications. No schema changes or new dependencies.

**Tech Stack:** TypeScript, Vitest for testing

---

### File Structure Overview

- **Modify:** `src/config/prompts/extract/rules.ts` - Add non-verbal vocalization, thoughts, and group handling rules
- **Modify:** `src/config/prompts/merge/rules.ts` - Update Rule 1 for semantic merge, Rule 5 for proper noun priority
- **Modify:** `src/config/prompts/qa/rules.ts` - Add conversational flow rule
- **Modify:** `src/services/llm/CharacterUtils.ts` - Make `normalizeCanonicalNames` a pass-through
- **Modify:** `src/services/llm/LLMVoiceService.ts` - Increase OVERLAP_SIZE to 10, adjust temperature range to 0.1-0.7
- **Modify:** `src/services/llm/CharacterUtils.test.ts` - Add test for `normalizeCanonicalNames` pass-through behavior

---

### Task 1: Update Extract Rules - Non-Verbal Vocalizations

**Files:**
- Modify: `src/config/prompts/extract/rules.ts`

- [ ] Step 1: Read current extract rules to understand Rule 3 structure

Run: `cat src/config/prompts/extract/rules.ts`

- [ ] Step 2: Modify Rule 3 to add non-verbal vocalization clarification

Add after the sound effects bullet in Rule 3:
```typescript
   - DO extract characters who make non-verbal vocalizations (e.g., grunts, screams, sighs, "eep", "hmm") IF it serves as a response or communication.
   - Do NOT extract purely environmental sound effects (e.g., [Bang!], *Crash*).
```

- [ ] Step 3: Verify the change

Run: `grep -A2 "sound effects" src/config/prompts/extract/rules.ts`
Expected: Shows both the old and new sound effect lines

- [ ] Step 4: Commit

```bash
git add src/config/prompts/extract/rules.ts && git commit -m "feat(extract): clarify non-verbal vocalizations vs environmental sounds"
```

---

### Task 2: Update Extract Rules - Thoughts and Groups

**Files:**
- Modify: `src/config/prompts/extract/rules.ts`

- [ ] Step 1: Add thoughts rule to Rule 3

Add after non-verbal vocalization bullet:
```typescript
   - THOUGHTS: When a character has thoughts (e.g., *I must run*), extract them as speaking and assign to that character. Thoughts use the SAME voice profile as spoken dialogue.
     Example: "John pondered. *I should leave.*" -> Extract John, assign the thought to John.
```

- [ ] Step 2: Add group/crowd dialogue rule to Rule 3

Add after thoughts bullet:
```typescript
   - GROUPS: If a group of people speak in unison (e.g., "the crowd", "the guards"), extract them as a single entity with gender "unknown".
     Example: "Kill the monster!" the crowd chanted. -> Extract "The Crowd", gender "unknown".
```

- [ ] Step 3: Verify both changes

Run: `grep -A2 "THOUGHTS\|GROUPS" src/config/prompts/extract/rules.ts`
Expected: Shows both new rules with examples

- [ ] Step 4: Commit

```bash
git add src/config/prompts/extract/rules.ts && git commit -m "feat(extract): add rules for thoughts and group dialogue"
```

---

### Task 3: Update Merge Rules - Semantic Merge

**Files:**
- Modify: `src/config/prompts/merge/rules.ts`

- [ ] Step 1: Read current merge Rule 1

Run: `cat src/config/prompts/merge/rules.ts | head -20`

- [ ] Step 2: Update Rule 1 to allow contextual merging

Replace:
```typescript
1. CHECK VARIATIONS:
   Look at the "variations" arrays. If Character A and Character B share a name in their variations, they are the same person.
```

With:
```typescript
1. CHECK VARIATIONS AND CONTEXT:
   If Character A and Character B share a name in their variations, MERGE them.
   If they do not share an exact name, but context clearly proves they are the same entity (e.g., "The Purple Man" and "The Registrar" in the same scene), MERGE them.
```

- [ ] Step 3: Verify the change

Run: `grep -A3 "CHECK VARIATIONS" src/config/prompts/merge/rules.ts`
Expected: Shows new contextual merge rule

- [ ] Step 4: Commit

```bash
git add src/config/prompts/merge/rules.ts && git commit -m "feat(merge): allow semantic/contextual merging when exact names don't match"
```

---

### Task 4: Update Merge Rules - Proper Noun Priority

**Files:**
- Modify: `src/config/prompts/merge/rules.ts`

- [ ] Step 1: Read current merge Rule 5

Run: `grep -A5 "HOW TO ORDER" src/config/prompts/merge/rules.ts`

- [ ] Step 2: Update Rule 5 to prioritize proper nouns

Replace Rule 5 with:
```typescript
5. HOW TO ORDER THE MERGE GROUP:
   A merge group must have AT LEAST 2 numbers.
   The FIRST number in the group must be the character's ACTUAL PROPER NAME (e.g., "Irogh", "Bacci").
   Proper nouns ALWAYS beat descriptive titles (e.g., "The Purple Man", "The Most Handsome Man"), even if the descriptor is longer.
   If no proper name exists, use the most descriptive title.
   Example: 0 is "Irogh". 1 is "The Most Handsome Man". The group should be [0, 1] because "Irogh" is the proper name.
```

- [ ] Step 3: Verify the change

Run: `grep -A7 "HOW TO ORDER" src/config/prompts/merge/rules.ts`
Expected: Shows proper noun priority rule with Irogh example

- [ ] Step 4: Commit

```bash
git add src/config/prompts/merge/rules.ts && git commit -m "feat(merge): prioritize proper nouns over descriptive titles"
```

---

### Task 5: Update QA Rules - Conversational Flow

**Files:**
- Modify: `src/config/prompts/qa/rules.ts`

- [ ] Step 1: Read current QA rules

Run: `cat src/config/prompts/qa/rules.ts`

- [ ] Step 2: Add conversational flow rule after Rule 3

After Rule 3 (MISSED ACTION BEATS), add:
```typescript
4. CONVERSATIONAL FLOW:
   Check if the assigned speaker logically makes sense for the quote content.
   If a quote says "I am Mary", but the draft assigned it to John due to proximity to an action beat, fix it.
   Dialogue content (self-identification, pronouns) overrides adjacent action beats.
   Example: John glared at Mary. "I'm Mary." -> Should be assigned to Mary, not John.
```

- [ ] Step 3: Renumber existing rules 4-7 to 5-8

Change:
- Rule 4 (MISASSIGNED NARRATION) -> Rule 5
- Rule 5 (MISSING DIALOGUE) -> Rule 6
- Rule 6 (NEGATIVE INDICES) -> Rule 7
- Rule 7 (OUTPUT FORMAT) -> Rule 8

- [ ] Step 4: Verify the changes

Run: `grep -A4 "CONVERSATIONAL FLOW\|MISASSIGNED NARRATION" src/config/prompts/qa/rules.ts`
Expected: Shows Rule 4 is conversational flow, Rule 5 is misassigned narration

- [ ] Step 5: Commit

```bash
git add src/config/prompts/qa/rules.ts && git commit -m "feat(qa): add conversational flow rule to catch self-identification errors"
```

---

### Task 6: Remove Length Check from CharacterUtils

**Files:**
- Modify: `src/services/llm/CharacterUtils.ts`
- Modify: `src/services/llm/CharacterUtils.test.ts`

- [ ] Step 1: Write failing test for `normalizeCanonicalNames` pass-through behavior

Add to `src/services/llm/CharacterUtils.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { cullByFrequency, normalizeCanonicalNames } from './CharacterUtils';

// ... existing tests ...

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
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/services/llm/CharacterUtils.test.ts --grep "should be a pass-through"`
Expected: FAIL - "expected 'Irogh' but got 'The Most Handsome Man'" (or similar)

- [ ] Step 3: Update `normalizeCanonicalNames` to be pass-through

Replace in `src/services/llm/CharacterUtils.ts`:
```typescript
/**
 * Normalize canonicalNames to use the longest variation.
 * This prevents merge validation failures when LLM picks a longer variation as "keep".
 */
export function normalizeCanonicalNames(characters: LLMCharacter[]): LLMCharacter[] {
  return characters.map((c) => {
    const longest = c.variations.reduce((a, b) => (a.length >= b.length ? a : b), c.canonicalName);
    return {
      ...c,
      canonicalName: longest,
    };
  });
}
```

With:
```typescript
/**
 * Normalize canonicalNames - now a pass-through.
 * The LLM's merge step handles proper noun prioritization via prompt instructions.
 */
export function normalizeCanonicalNames(characters: LLMCharacter[]): LLMCharacter[] {
  // Trust the LLM's ordering from merge step - proper nouns prioritized via prompt
  return characters;
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/services/llm/CharacterUtils.test.ts --grep "normalizeCanonicalNames"`
Expected: PASS for both new tests

- [ ] Step 5: Commit

```bash
git add src/services/llm/CharacterUtils.ts src/services/llm/CharacterUtils.test.ts && git commit -m "feat(character-utils): remove length-based canonicalName override"
```

---

### Task 7: Increase Overlap Size

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

- [ ] Step 1: Read current OVERLAP_SIZE definition

Run: `grep -n "OVERLAP_SIZE" src/services/llm/LLMVoiceService.ts`
Expected: Shows line 81 with `const OVERLAP_SIZE = 5;`

- [ ] Step 2: Change OVERLAP_SIZE from 5 to 10

Replace line 81:
```typescript
// BEFORE:
const OVERLAP_SIZE = 5;

// AFTER:
const OVERLAP_SIZE = 10;
```

- [ ] Step 3: Verify the change

Run: `grep "OVERLAP_SIZE" src/services/llm/LLMVoiceService.ts`
Expected: Shows `const OVERLAP_SIZE = 10;`

- [ ] Step 4: Commit

```bash
git add src/services/llm/LLMVoiceService.ts && git commit -m "feat(assign): increase overlap context from 5 to 10 sentences"
```

---

### Task 8: Adjust Temperature Range

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

- [ ] Step 1: Read current temperature calculation

Run: `grep -n "Math.round(Math.random" src/services/llm/LLMVoiceService.ts`
Expected: Shows line 557 with temperature formula

- [ ] Step 2: Change temperature range from 0.0-1.0 to 0.1-0.7

Replace line 557:
```typescript
// BEFORE:
const temp = Math.round(Math.random() * 10) / 10; // Random temperature 0.0-1.0, rounded to 0.1

// AFTER:
const temp = 0.1 + Math.round(Math.random() * 6) / 10; // Random temperature 0.1-0.7, rounded to 0.1
```

- [ ] Step 3: Verify the change

Run: `grep -A1 "const temp" src/services/llm/LLMVoiceService.ts | grep -A1 "mergeVoteCount"`
Expected: Shows new temperature formula with 0.1-0.7 range

- [ ] Step 4: Commit

```bash
git add src/services/llm/LLMVoiceService.ts && git commit -m "feat(merge): adjust voting temperature range from 0.0-1.0 to 0.1-0.7"
```

---

### Task 9: Run All Tests

**Files:**
- All modified files

- [ ] Step 1: Run full test suite

Run: `npm test`
Expected: All tests pass

- [ ] Step 2: If any tests fail, fix them

Common issues:
- Prompt content tests may need updating if they assert on specific rule text
- Run: `npm test -- --grep "extract\|merge\|qa"` to find failing prompt tests

- [ ] Step 3: Commit any test fixes

```bash
git add -A && git commit -m "test: update prompt content tests for new rules"
```

---

### Task 10: Final Verification and Commit Design Doc

**Files:**
- `docs/designs/2026-03-30-prompt-rules-refinement.md`

- [ ] Step 1: Verify all changes are committed

Run: `git status`
Expected: Clean working tree or only design doc uncommitted

- [ ] Step 2: Commit design document

```bash
git add docs/designs/2026-03-30-prompt-rules-refinement.md && git commit -m "docs: add prompt rules refinement design document"
```

- [ ] Step 3: Show summary of all commits

Run: `git log --oneline -10`
Expected: Shows all 9+ commits for this feature

---

## Common Pitfalls

- **Prompt tests:** Some tests may assert on exact rule text. If `npm test` fails after prompt changes, check `src/config/prompts/__tests__/` for tests that verify rule content.
- **Import statements:** When adding tests to `CharacterUtils.test.ts`, ensure the import for `normalizeCanonicalNames` is added.
- **Line numbers:** The plan references line numbers (81, 557) based on codebase analysis. If the file has changed, use `grep -n` to find the actual line numbers.

## Rollback Commands (if needed)

```bash
# Revert all changes
git reset --hard HEAD~10  # Adjust number based on commits made

# Or revert individual files
git checkout src/config/prompts/extract/rules.ts
git checkout src/config/prompts/merge/rules.ts
git checkout src/config/prompts/qa/rules.ts
git checkout src/services/llm/CharacterUtils.ts
git checkout src/services/llm/LLMVoiceService.ts
git checkout src/services/llm/CharacterUtils.test.ts
```
