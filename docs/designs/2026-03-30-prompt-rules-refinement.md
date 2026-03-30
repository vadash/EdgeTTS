# Prompt Rules Refinement Design

## Overview

Refine LLM prompt rules based on production testing with complex web novels (Ar'Kendrithyst). Fix logical contradictions and blind spots in extraction, merge, and QA stages.

## Goals

- Clarify boundary between character vocalizations and environmental sounds
- Prioritize proper nouns over descriptive titles in canonical names
- Enable contextual/semantic merging when exact string matches fail
- Handle group/crowd dialogue explicitly
- Improve QA pass to catch action-beat misdirections
- Increase overlap context for better speaker continuity
- Add thought handling rule with example
- Reduce temperature range to minimize hallucinations

## Non-Goals

- No schema changes (skip speech_type enum for thoughts)
- No paragraph-based overlap (keep sentence-based, just increase count)
- No new gender values (keep male/female/unknown, groups use "unknown")

## Changes

### 1. Extract Rules - Non-Verbal Vocalizations

**File:** `src/config/prompts/extract/rules.ts`

Update Rule 3 to distinguish character vocalizations from environmental sounds:

```typescript
// Add after existing Rule 3 bullet about sound effects:
// NEW:
- DO extract characters who make non-verbal vocalizations (e.g., grunts, screams, sighs, "eep", "hmm") IF it serves as a response or communication.
- Do NOT extract purely environmental sound effects (e.g., [Bang!], *Crash*).
```

### 2. Extract Rules - Thoughts Use Character Voice

**File:** `src/config/prompts/extract/rules.ts`

Add rule about thoughts using the same voice:

```typescript
// Add to Rule 3 (WHO NOT TO EXTRACT) or create new Rule 4:
- THOUGHTS: When a character has thoughts (e.g., *I must run*), extract them as speaking and assign to that character. Thoughts use the SAME voice profile as spoken dialogue.
  Example: "John pondered. *I should leave.*" -> Extract John, assign the thought to John.
```

### 3. Merge Rules - Proper Noun Priority

**File:** `src/config/prompts/merge/rules.ts`

Update Rule 5 to prioritize proper nouns:

```typescript
// BEFORE:
5. HOW TO ORDER THE MERGE GROUP:
   A merge group must have AT LEAST 2 numbers.
   The FIRST number in the group must be the character with the longest, most complete, or best "canonicalName".

// AFTER:
5. HOW TO ORDER THE MERGE GROUP:
   A merge group must have AT LEAST 2 numbers.
   The FIRST number in the group must be the character's ACTUAL PROPER NAME (e.g., "Irogh", "Bacci").
   Proper nouns ALWAYS beat descriptive titles (e.g., "The Purple Man", "The Most Handsome Man"), even if the descriptor is longer.
   If no proper name exists, use the most descriptive title.
   Example: 0 is "Irogh". 1 is "The Most Handsome Man". The group should be [0, 1] because "Irogh" is the proper name.
```

### 4. CharacterUtils.ts - Remove Length Check

**File:** `src/services/llm/CharacterUtils.ts`

Remove the `normalizeCanonicalNames` function's `.reduce` logic:

```typescript
// BEFORE:
export function normalizeCanonicalNames(characters: LLMCharacter[]): LLMCharacter[] {
  return characters.map((c) => {
    const longest = c.variations.reduce((a, b) => (a.length >= b.length ? a : b), c.canonicalName);
    return {
      ...c,
      canonicalName: longest,
    };
  });
}

// AFTER: Remove entirely (or make it a pass-through if still referenced)
export function normalizeCanonicalNames(characters: LLMCharacter[]): LLMCharacter[] {
  // Trust the LLM's ordering from merge step - proper nouns prioritized via prompt
  return characters;
}
```

**Impact:** Callers of `normalizeCanonicalNames` will still work, but now trust LLM ordering instead of length-based override.

### 5. Merge Rules - Semantic Merge

**File:** `src/config/prompts/merge/rules.ts`

Update Rule 1 to allow contextual merging:

```typescript
// BEFORE:
1. CHECK VARIATIONS:
   Look at the "variations" arrays. If Character A and Character B share a name in their variations, they are the same person.

// AFTER:
1. CHECK VARIATIONS AND CONTEXT:
   If Character A and Character B share a name in their variations, MERGE them.
   If they do not share an exact name, but context clearly proves they are the same entity (e.g., "The Purple Man" and "The Registrar" in the same scene), MERGE them.
```

### 6. Extract Rules - Group/Crowd Dialogue

**File:** `src/config/prompts/extract/rules.ts`

Add rule for group entities:

```typescript
// Add to Rule 3 (WHO NOT TO EXTRACT):
- GROUPS: If a group of people speak in unison (e.g., "the crowd", "the guards"), extract them as a single entity with gender "unknown".
  Example: "Kill the monster!" the crowd chanted. -> Extract "The Crowd", gender "unknown".
```

### 7. QA Rules - Conversational Flow

**File:** `src/config/prompts/qa/rules.ts`

Add rule after Rule 3:

```typescript
// NEW Rule 4 (renumber existing):
4. CONVERSATIONAL FLOW:
   Check if the assigned speaker logically makes sense for the quote content.
   If a quote says "I am Mary", but the draft assigned it to John due to proximity to an action beat, fix it.
   Dialogue content (self-identification, pronouns) overrides adjacent action beats.
   Example: John glared at Mary. "I'm Mary." -> Should be assigned to Mary, not John.
```

### 8. LLMVoiceService.ts - Overlap Size

**File:** `src/services/llm/LLMVoiceService.ts`

Increase overlap from 5 to 10 sentences:

```typescript
// Line 81 (approx):
// BEFORE:
const OVERLAP_SIZE = 5;

// AFTER:
const OVERLAP_SIZE = 10;
```

### 9. LLMVoiceService.ts - Temperature Range

**File:** `src/services/llm/LLMVoiceService.ts`

Adjust merge voting temperature from 0.0-1.0 to 0.1-0.7:

```typescript
// Line 557 (approx):
// BEFORE:
const temp = Math.round(Math.random() * 10) / 10; // Random temperature 0.0-1.0

// AFTER:
const temp = 0.1 + Math.round(Math.random() * 6) / 10; // Random temperature 0.1-0.7
```

## Testing Strategy

1. **Unit tests:** Verify `normalizeCanonicalNames` is now pass-through
2. **Integration tests:** Run pipeline on sample chapters with:
   - Characters with descriptive titles ("The Purple Man")
   - Group dialogue ("the crowd chanted")
   - Thoughts (`*I must run*`)
   - Non-verbal vocalizations ("eep", "hmm")
   - Contextual character matches (same entity, different descriptions)

## Rollback Plan

All changes are prompt/text-based. If issues arise:
1. Revert individual prompt files from git
2. Restore `OVERLAP_SIZE = 5`
3. Restore temperature formula

## Files Modified

- `src/config/prompts/extract/rules.ts`
- `src/config/prompts/merge/rules.ts`
- `src/config/prompts/qa/rules.ts`
- `src/services/llm/CharacterUtils.ts`
- `src/services/llm/LLMVoiceService.ts`
