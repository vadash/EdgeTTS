# Test Suite Reduction — Balanced Cut Implementation Plan

**Goal:** Reduce test count by ~20-30% by deleting Zod/boilerplate tests, merging fragmented files, parameterizing repetitive test structures, and trimming store signal round-trips.
**Testing Conventions:** Vitest with JSdom environment. All external calls (network, File System API, WebSockets) must be mocked. `p-retry`, `p-queue`, and `generic-pool` are globally mocked in `src/test/setup.ts`. Run `npm test` after every task.

---

### Task 1: Delete Schema Test Files

**Objective:** Remove two files that test Zod library behavior (not application logic). Zero-risk deletion — `safeParseJSON` integration coverage exists in `src/utils/text.test.ts`.

**Files to modify/create:**
- Delete: `src/services/llm/schemas.test.ts` (22 tests — tests Zod `safeParse` required fields, `.min(1)`, invalid enums, extra-field passthrough)
- Delete: `src/test/unit/services/llm/schemas.test.ts` (3 tests — subset of above, tests extra-keys-allowed on three schemas)

**Instructions for Execution Agent:**
1. **Delete both files.** No code to write — these test Zod internals, not app logic.
2. **Verify:** Run `npm test`. Confirm all remaining tests pass and no import references to these deleted files exist (Vitest auto-discovers test files, so there should be no import breakage).
3. **Commit:** `chore: delete Zod schema tests (library behavior, not app logic)`

---

### Task 2: Merge Text Parsing Tests into Single File

**Objective:** Consolidate three fragmented text-parsing test files into `src/utils/text.test.ts`, deduplicating overlapping cases and bringing in unique edge cases from the other two files.

**Files to modify/create:**
- Modify: `src/utils/text.test.ts` (merge target — add cases from the two files below)
- Delete: `src/test/unit/utils/text.test.ts` (~16 tests — `safeParseJSON` edge cases: array-at-root, flattened assignments, AntML tags)
- Delete: `src/utils/__tests__/text.toolcall.test.ts` (4 tests — `stripThinkingTags` tool_call format variants)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full content of all three files to understand what each covers. The main file (`src/utils/text.test.ts`) is the merge target.
2. **Deduplication Strategy:**
   - For `stripThinkingTags`: the main file already has `<tool_call name="...">` tests. From `text.toolcall.test.ts`, add only genuinely new formats: `<|tool_call|>`, `<|someKey|>`, `<|content|>` inside JSON values, nested `<|...|>` objects, standalone `<|...|>` blocks.
   - For `safeParseJSON`: the main file already covers thinking tags, markdown fenced JSON, broken JSON, embedded JSON extraction. From `src/test/unit/utils/text.test.ts`, add only cases not duplicated: array-at-root wrapping into schema, flattened assignments recovery (`{"0":"A"}` → wrapped), naked array + no-array schema rejection, typo in field name with jsonrepair, and any extract/merge/assign schema edge cases not already in main.
   - If both files test the **same input with the same assertion**, keep one copy. If they test **different edge cases on the same function**, keep both.
3. **Merge:** Insert the unique test cases into the appropriate `describe` blocks in `src/utils/text.test.ts`. Maintain the existing structure: `describe('stripThinkingTags')` and `describe('safeParseJSON')` and `describe('extractJsonBlocks')`.
4. **Delete** the two source files after confirming their unique cases have been transferred.
5. **Verify:** Run `npm test`. Confirm all text utility tests pass and no edge cases were lost.
6. **Commit:** `refactor: merge text parsing tests into single file`

---

### Task 3: Parameterize TextBlockSplitter Tests

**Objective:** Collapse ~10 repetitive test cases in `TextBlockSplitter.test.ts` that differ only in a string literal into `test.each` parameterized blocks.

**Files to modify/create:**
- Modify: `src/services/TextBlockSplitter.test.ts` (parameterize divider detection, chapter header detection, and narration splitting tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full file to identify the repetitive tests. The file has ~99 symbols (many test functions).
2. **Parameterize divider detection:** Find the 5 tests that each pass a different divider string (`***`, `---`, `* * *`, `===`, `___`) with identical structure and assertion (`expect(blocks.length).toBe(2)`). Replace with a single `test.each` block taking `[divider, description]` pairs.
3. **Parameterize chapter header detection:** Find the 5 tests for chapter headers (`Chapter 5`, `Глава 3`, `Prologue`, `Epilogue`, `Book 2`) with identical structure. Replace with a single `test.each`.
4. **Parameterize narration splitting:** If the 3 narration tests (long narration, dialogue-in-narration, short narration) share the same assertion pattern, collapse into `test.each`. If they assert different block counts, keep them individually.
5. **Keep individually** (do NOT parameterize): multi-divider sequences, consecutive dividers, small block before divider, giant block exceeding limit, `createAssignBlocks` / `createExtractBlocks` integration tests, and the "long chapter title is NOT treated as header" test (different assertion logic).
6. **Verify:** Run `npm test`. Confirm the parameterized tests produce identical pass/fail results to the originals.
7. **Commit:** `refactor: parameterize TextBlockSplitter divider and chapter tests`

---

### Task 4: Remove Empty `src/test/unit/` Directory

**Objective:** Clean up the empty directory left after deleting its contents in Tasks 1 and 2.

**Files to modify/create:**
- Delete directory: `src/test/unit/` (should now be empty after `src/test/unit/services/llm/schemas.test.ts` and `src/test/unit/utils/text.test.ts` were removed)

**Instructions for Execution Agent:**
1. **Verify empty:** Confirm `src/test/unit/` has no remaining files. If files remain, do NOT proceed — report what's left.
2. **Delete** the `src/test/unit/` directory tree.
3. **Verify:** Run `npm test`. Confirm all tests still pass.
4. **Commit:** `chore: remove empty src/test/unit/ directory`

---

### Task 5: Merge PromptStrategy Fallback Tests into Main File

**Objective:** Move the 3 tests from the fallback file into `PromptStrategy.test.ts` as a new `describe` block, then delete the fallback file.

**Files to modify/create:**
- Modify: `src/services/llm/PromptStrategy.test.ts` (add a `describe('fallback: unmapped codes')` block at the end)
- Delete: `src/services/llm/PromptStrategy.fallback.test.ts` (3 tests, ~40 lines — tests `parseAssignResponse` with invalid codes)

**Instructions for Execution Agent:**
1. **Context Setup:** Read both files. Understand the fallback file's imports, test data, and assertions.
2. **Merge:** Copy the 3 fallback tests into `PromptStrategy.test.ts` as a new `describe('fallback: unmapped codes')` block at the end of the file. Ensure any imports or helper variables from the fallback file are available in the main file (they likely share the same imports).
3. **Delete** `src/services/llm/PromptStrategy.fallback.test.ts`.
4. **Verify:** Run `npm test`. Confirm all PromptStrategy tests pass, including the moved fallback tests.
5. **Commit:** `refactor: merge PromptStrategy fallback tests into main test file`

---

### Task 6: Trim LLMStore Tests

**Objective:** Remove signal round-trip and trivial-default tests from `LLMStore.test.ts`, reducing from ~63 to ~42 tests. Convert repeated-set-input tests for the same computed signal into `test.each`.

**Depends on:** Tasks 1-5 (do this last category — it's the largest and needs careful review).

**Files to modify/create:**
- Modify: `src/stores/LLMStore.test.ts` (remove pure signal round-trips, obvious defaults, redundant getters; parameterize where appropriate)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full file. Identify each test case and classify it using the criteria below.
2. **Deletion criteria — delete tests that meet ANY of:**
   - **Pure signal round-trip:** `store.setX(val); expect(store.getX()).toBe(val)` — this tests the signals library.
   - **Obvious defaults:** `expect(store.getX()).toBe(initialValue)` where the initial value is set in the constructor — this tests the constructor assignment.
   - **Redundant getter:** a test reads a signal immediately after setting it, but the same `set` is also tested with a derived signal read — keep only the derived signal assertion.
3. **Keep criteria — preserve tests that involve:**
   - Computed/derived signals (values depending on multiple inputs)
   - State machine transitions (idle → processing → complete)
   - Side effects (storage writes, event emissions, signal subscriptions)
   - Boundary conditions (edge cases in computation, not just the default case)
4. **Parameterization:** Where multiple tests set `characters` and then check `characterLineCounts` with different inputs, convert to `test.each` with `{ characters: [...], expectedCounts: {...} }` rows.
5. **Verify:** Run `npm test`. Confirm all remaining tests pass. Count the surviving tests — target is ~42 (±5).
6. **Commit:** `refactor: trim LLMStore signal round-trip tests`

---

### Task 7: Trim DataStore Tests

**Objective:** Remove signal round-trip and trivial-default tests from `DataStore.test.ts`, reducing from ~59 to ~40 tests.

**Depends on:** Task 6 (same approach, applied to a different store).

**Files to modify/create:**
- Modify: `src/stores/DataStore.test.ts` (apply same deletion and parameterization criteria as Task 6)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full file. Classify each test using the deletion/keep criteria from Task 6.
2. **Delete** pure signal round-trips, obvious defaults, and redundant getters.
3. **Keep** computed signals, state transitions, side effects, and boundary conditions.
4. **Parameterize** where multiple tests exercise the same computed signal with different inputs.
5. **Verify:** Run `npm test`. Target is ~40 tests (±5).
6. **Commit:** `refactor: trim DataStore signal round-trip tests`

---

### Task 8: Trim ConversionStore Tests

**Objective:** Remove signal round-trip and trivial-default tests from `ConversionStore.test.ts`, reducing from ~60 to ~40 tests.

**Depends on:** Task 7 (same approach, applied to a different store).

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.test.ts` (apply same deletion and parameterization criteria as Tasks 6-7)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full file. Classify each test using the deletion/keep criteria.
2. **Delete** pure signal round-trips, obvious defaults, and redundant getters. The file has many timestamp-related tests (setting startTime/assignStartTime and reading derived durations) — keep only those where the computation is non-trivial (e.g., elapsed time calculation, progress percentage). Delete tests that merely verify a set value is readable.
3. **Keep** computed signals (elapsed time, progress, estimated time remaining), state machine transitions (idle → processing → complete), side effects, and boundary conditions.
4. **Parameterize** where multiple tests exercise the same computed signal with different inputs.
5. **Verify:** Run `npm test`. Target is ~40 tests (±5).
6. **Commit:** `refactor: trim ConversionStore signal round-trip tests`

---

## Execution Summary

| Task | Category | Tests Affected | Risk |
|------|----------|---------------|------|
| 1 | Schema test deletion | ~25 removed | Zero |
| 2 | Text parsing merge | ~10 deduplicated | Low |
| 3 | TextBlockSplitter parameterize | ~10 collapsed | Low |
| 4 | Remove empty directory | 0 | Zero |
| 5 | PromptStrategy merge | 3 moved | Zero |
| 6 | LLMStore trim | ~21 removed | Medium |
| 7 | DataStore trim | ~19 removed | Medium |
| 8 | ConversionStore trim | ~20 removed | Medium |

**Total estimated reduction:** ~115-135 tests removed, 5-6 files deleted.
**Order matters:** Tasks 1-5 are independent of each other but should be done before 6-8. Store trimming (6-8) should be done sequentially with `npm test` verification after each.
