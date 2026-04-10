# Test Suite Reduction — Balanced Cut

**Date**: 2026-04-11
**Status**: Draft
**Goal**: Reduce test count by 25-35% (~150-200 tests out of ~650) across all areas.

## Problem

After 2 months of TDD the suite has accumulated ~63 test files and ~600-700 test cases. Issues:

1. **Exact duplicates** — separate files testing the same thing
2. **Fragmented coverage** — one function tested across 3 files
3. **Testing library behavior** — Zod `safeParse` validation, Preact signals get/set round-trips
4. **Copy-paste structure** — 22 tests differing only in a string literal (divider type, chapter keyword)
5. **Signal boilerplate** — store tests that are `set value → expect getter === value` with no computation

## Scope

All test directories: services, stores, utils, config.

Coverage numbers are not a constraint. We keep tests that catch real regressions.

---

## Category 1: File Deletions

### 1A. Delete `src/services/llm/schemas.test.ts` (22 tests)

Tests Zod `safeParse` — required fields are required, empty strings fail `.min(1)`, invalid enums fail, extra fields pass through. This tests Zod, not application logic. The actual JSON parsing + schema validation integration is already covered by `safeParseJSON` tests in `text.test.ts`.

### 1B. Delete `src/test/unit/services/llm/schemas.test.ts` (3 tests)

Subset of the above file. Tests extra-keys-allowed on three schemas — already covered in the main file (which we're also deleting).

### 1C. Delete `src/test/unit/utils/text.test.ts` (~16 tests)

Merged into `src/utils/text.test.ts`. See Category 2.

### 1D. Delete `src/utils/__tests__/text.toolcall.test.ts` (4 tests)

Merged into `src/utils/text.test.ts`. See Category 2.

### 1E. Delete `src/test/unit/` directory

Emptied by 1B and 1C. Remove the directory.

**Category 1 subtotal: ~45 tests, 4-5 files removed.**

---

## Category 2: Merge — Text Parsing Tests

Merge 3 files into `src/utils/text.test.ts`:

| Source | Content |
|--------|---------|
| `src/utils/text.test.ts` (259 lines) | Base tests for `stripThinkingTags`, `safeParseJSON`, `extractJsonBlocks` |
| `src/test/unit/utils/text.test.ts` (172 lines) | Additional `safeParseJSON` edge cases (array-at-root, flattened assignments, AntML tags) |
| `src/utils/__tests__/text.toolcall.test.ts` (25 lines) | `stripThinkingTags` tool_call format variants |

### Merged structure

```
describe('stripThinkingTags')
  existing cases from main:
    - standard <thinking> tags
    - partial/mismatched tags
    - [THINK] variant
    - *thinks:* and (thinking:) variants
    - <reasoning> tags
    - <tool_call name="..."> tags
    - clean JSON passthrough
    - large content performance
    - closing-only </thinking> variant
  new cases from toolcall test:
    - <|tool_call|> format
    - <|someKey|> format
  new cases from unit test:
    - <|content|> inside JSON values
    - nested <|...|> objects
    - standalone <|...|> blocks

describe('safeParseJSON')
  existing cases from main:
    - valid JSON with schema
    - thinking tags + JSON
    - markdown fenced JSON
    - broken JSON (JS concatenation)
    - embedded JSON extraction
    - non-JSON rejection
    - schema mismatch
    - closing-only thinking + JSON
    - no-schema passthrough
    - full ExtractSchema integration
  new cases from unit test:
    - array-at-root wrapping into schema
    - flattened assignments recovery ({"0":"A"} → wrapped)
    - naked array + no-array schema (rejection)
    - typo in field name with jsonrepair
    - extract/merge/assign schema edge cases (deduplicate against main)

describe('extractJsonBlocks')
  from main file only (no overlap):
    - single block extraction
    - multiple blocks
    - no blocks
```

Deduplication rule: if both files test the same input → same assertion, keep one copy. If they test different edge cases with the same function, keep both.

**Category 2 subtotal: ~20 tests deduplicated/merged, 2 files deleted (counted in Category 1).**

---

## Category 3: Parameterization — TextBlockSplitter

`src/services/TextBlockSplitter.test.ts` has ~22 tests with identical structure:

```ts
const maxTokens = 100;
const filler = tokenFill(86);
const blocks = splitter.splitIntoBlocks([filler, DIVIDER, 'After divider.'], maxTokens);
expect(blocks.length).toBe(2);
```

Only the divider string varies. Collapse into `test.each`:

### Divider detection (5 tests → 1)

```ts
test.each([
  ['***', 'standard divider'],
  ['---', 'dash divider'],
  ['* * *', 'spaced asterisk'],
  ['===', 'equals divider'],
  ['___', 'underscore divider'],
])('splits at %s (%s)', (divider, _) => {
  const blocks = splitter.splitIntoBlocks(
    [tokenFill(86), divider, 'After divider.'], 100
  );
  expect(blocks.length).toBe(2);
});
```

### Chapter header detection (5 tests → 1)

```ts
test.each([
  ['Chapter 5', 'English chapter'],
  ['Глава 3', 'Russian chapter'],
  ['Prologue', 'prologue'],
  ['Epilogue', 'epilogue'],
  ['Book 2', 'book header'],
])('splits at %s (%s)', (header, _) => { ... });
```

### Long chapter title (1 test → keep as-is)

Test that `"Chapter 1 was about the time he went to the store"` is NOT treated as a header. Different assertion, worth keeping individually.

### Narration splitting (3 tests → 1 parameterized)

Long narration, dialogue-in-narration, short narration. Keep each if they assert different block counts; parameterize if they share the same assertion pattern.

### Keep individually:

- Multi-divider sequences (`***` then `---`)
- Consecutive dividers (`***` then `***`)
- Small block before divider (different token budget)
- Giant block exceeding limit
- `createAssignBlocks` / `createExtractBlocks` integration tests (3 tests — genuinely different API)

**Category 3 subtotal: ~10 fewer test cases.**

---

## Category 4: Store Test Trimming

### Deletion criteria

Delete individual tests that meet ANY of:

1. **Pure signal round-trip**: `store.setX(val); expect(store.getX()).toBe(val)` — this tests the signals library
2. **Obvious defaults**: `expect(store.getX()).toBe(initialValue)` where the initial value is set in the constructor — this tests the constructor assignment
3. **Redundant getter**: a test that reads a signal immediately after setting it in a test that also reads a derived signal from the same set — keep only the derived signal assertion

### Keep criteria

1. **Computed/derived signals** — values that depend on multiple inputs
2. **State machine transitions** — sequences like idle → processing → complete
3. **Side effects** — storage writes, event emissions, signal subscriptions
4. **Boundary conditions** — edge cases in the computation (not just the default case)

### Targets per file

| File | Current | Target | Est. cut |
|------|---------|--------|----------|
| `LLMStore.test.ts` | ~63 | ~42 | ~21 |
| `DataStore.test.ts` | ~59 | ~40 | ~19 |
| `ConversionStore.test.ts` | ~60 | ~40 | ~20 |

These files will need a pass-by-pass review during implementation. The counts above are estimates — the actual cut depends on how many tests are pure signal round-trips vs. computed logic.

### Merge opportunities in stores

Where multiple tests test the same computed signal with different inputs, convert to `test.each`:

```ts
// Before: 4 separate tests for setCharacters + characterLineCounts
// After: 1 parameterized test
test.each([
  { characters: [...], expectedCounts: {...} },
  { characters: [...], expectedCounts: {...} },
]) ...
```

**Category 4 subtotal: ~60 tests cut across 3 files.**

---

## Category 5: Small File Merges

### Merge `PromptStrategy.fallback.test.ts` → `PromptStrategy.test.ts`

The fallback file (3 tests, ~40 lines) tests edge cases for `parseAssignResponse` with invalid codes. Add these as a `describe('fallback: unmapped codes')` block at the end of the main `PromptStrategy.test.ts`. Same function, same test subject, no reason for a separate file.

**Category 5 subtotal: 1 file deleted, 3 tests preserved.**

---

## Summary

| Category | Tests removed | Files removed |
|----------|-------------|---------------|
| 1. Deletions (duplicates + Zod tests) | ~45 | 4-5 |
| 2. Text parsing merge (dedup) | ~20 (net ~10 after merge) | 2 (counted above) |
| 3. TextBlockSplitter parameterize | ~10 | 0 |
| 4. Store trimming | ~60 | 0 |
| 5. Small file merges | 0 (tests preserved) | 1 |
| **Total** | **~115-135** | **5-6** |

Starting from ~650 tests: **~515-535 tests remain** (~18-21% reduction by count).

If store trimming hits the higher end of estimates (~80 tests cut instead of ~60), we reach the 25-30% target.

---

## Implementation Order

1. **Category 1A-1B** — Delete schema test files. Run `npm test`. Zero risk.
2. **Category 2** — Merge text parsing tests into one file. Run `npm test`. Verify no edge cases lost.
3. **Category 3** — Parameterize TextBlockSplitter. Run `npm test`.
4. **Category 1E** — Remove empty `src/test/unit/` directory.
5. **Category 5** — Merge fallback test into main PromptStrategy test.
6. **Category 4** — Store test trimming (largest, needs careful review). One store file at a time, run `npm test` after each.

Each step is independently committable. If a step breaks something, revert that commit and re-evaluate.

## Files Not Changed

- All integration tests (`__tests__/ChunkStore.integration.test.ts`, `ladder-integration.test.ts`, `ConversionOrchestrator.resume.test.ts`)
- Real API test (`llm-real.test.ts`)
- Prompt rules tests (`assign.rules.test.ts`, `extract.rules.test.ts`, etc.) — kept for now, these test prompt content which is domain-critical even if brittle
- `TTSWorkerPool.test.ts`, `TTSWorkerPool.ladder.test.ts` — legitimately different scopes
- All mock/helper infrastructure (`src/test/mocks/`, `src/test/factories/`, `src/test/fixtures/`)
- `SettingsStore.test.ts`, `VolumeStore.test.ts`, `ConversionStateStore.test.ts` — small files, no significant bloat
- `AudioMerger.test.ts` — binary format tests, each tests distinct byte patterns
