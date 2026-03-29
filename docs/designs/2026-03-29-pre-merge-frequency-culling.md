# Pre-Merge Frequency Culling

**Date:** 2026-03-29
**Status:** Approved

## Problem

After LLM extraction, a book can produce 600+ characters — many are hallucinations, one-line mentions, or noise. All of these flow into LLM Merge (5 votes at random temperatures) and then into Assign prompts, wasting tokens and confusing the LLM. Real data from *A Practical Guide to Evil* (Book 2): 687 extracted characters, of which 204 had ≤5 speaking lines.

## Solution

Add a text-mention frequency filter between Simple Merge and LLM Merge in `extractCharacters()`. Characters whose name/variations appear fewer than 3 times in the raw book text get culled. This strips hallucinations and ultra-minor characters before the expensive LLM Merge call.

## Data-Driven Threshold Decision

Analysis of *A Practical Guide to Evil* (2.8M words, 687 characters):

| Threshold | Kept | Culled | Lines lost to unnamed pool |
|-----------|------|--------|----------------------------|
| 1         | 637  | 49     | 21,332 (50.0%)             |
| 2         | 575  | 111    | 21,614 (50.6%)             |
| **3**     | **540** | **146** | **21,915 (51.3%)**      |
| 5         | 471  | 215    | 22,451 (52.6%)             |

- Fixed threshold of **3** is the sweet spot — aggressively culls noise while preserving all important characters.
- Dynamic thresholds (proportional to book length) proved too aggressive for large books.
- Important characters always have far more than 3 text mentions — the threshold itself is the protection. No role-based safeguards needed.
- "Narrator" is not an `LLMCharacter` (it's a separate `narratorVoice` setting), so it cannot be culled.
- "Protagonist" and "System" are extracted with high text frequency and never approach the threshold.

## Design

### 1. Function: `cullByFrequency` in `CharacterUtils.ts`

```typescript
export function cullByFrequency(
  characters: LLMCharacter[],
  fullText: string,
  threshold: number = 3,
): LLMCharacter[]
```

**Algorithm:**
1. For each character, iterate over `variations[]`
2. Skip any variation shorter than 3 characters (avoids "I", "he", "me" etc.)
3. Count non-overlapping occurrences via `indexOf` in the lowercased text
4. Sum all variation counts into a total
5. Keep character if total >= threshold

**Why `indexOf` over regex:** Language-agnostic — works correctly across Russian, Chinese, English without word boundary (`\b`) issues. Substring overcounting (e.g., "Cat" inside "Catastrophe") is negligible at threshold 3 since real characters have hundreds of legitimate mentions.

### 2. Integration Point in `extractCharacters()`

In `LLMVoiceService.ts`, after `mergeCharacters()` and before `mergeCharactersWithLLM()`:

```typescript
// Simple merge by canonicalName
let merged = mergeCharacters(allCharacters);

// Pre-merge frequency culling
const fullText = blocks
  .map(b => b.sentences.join('\n'))
  .join('\n')
  .toLowerCase();

const beforeCull = merged.length;
merged = cullByFrequency(merged, fullText);

this.logger?.info(
  `[Extract] Culled ${beforeCull - merged.length}/${beforeCull} characters ` +
  `by frequency (threshold=3). Remaining: ${merged.length}`
);

// LLM merge if multiple blocks and characters
if (blocks.length > 1 && merged.length > 1) {
  merged = await this.mergeCharactersWithLLM(merged, onProgress);
}
```

- `fullText` constructed once from blocks and lowercased before passing in
- No progress callback — culling is instantaneous (~5ms for a 2.8M word book)
- Logging shows before/after counts for debugging

### 3. Fallback for Culled Characters

Characters culled here have no code mapping in Assign. When the LLM encounters their dialogue lines in Phase 3, it naturally assigns them to the generic unnamed pool (`MALE_UNNAMED`, `FEMALE_UNNAMED`, `UNKNOWN_UNNAMED`) which already exist in `buildCodeMapping`. No changes needed to downstream phases.

### 4. Testing Strategy

Unit tests for `cullByFrequency` — pure function, no mocks needed:

| Test Case | Description |
|-----------|-------------|
| Basic culling | Characters below threshold removed, above survive |
| Variation summing | Multiple variations count toward the same total |
| Short variation skip | Variations < 3 chars are ignored in the count |
| Threshold boundary | Character with exactly 3 mentions kept (inclusive) |
| Zero mentions | Character never appearing in text is culled |
| Empty input | Empty array or empty text returns empty array |
| All survive | All characters above threshold — same-length array returned |
| Case insensitive | Lowercase text matches mixed-case names correctly |

## Files Changed

| File | Change |
|------|--------|
| `src/services/llm/CharacterUtils.ts` | Add `cullByFrequency` function |
| `src/services/llm/LLMVoiceService.ts` | Call `cullByFrequency` in `extractCharacters()` |
| `src/test/` | Unit tests for `cullByFrequency` |
