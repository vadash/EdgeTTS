# Hard Cut Fallback for TextBlockSplitter Implementation Plan

**Goal:** Add a hard-cut fallback to `TextBlockSplitter.splitIntoParagraphs()` that guarantees no paragraph exceeds 3000 characters, and remove the now-redundant `splitLongSentence()` method.

**Testing Conventions:** Use Vitest with TDD red-green methodology. Write failing tests first, run `npm test -- --run` to verify failure, then implement minimal code to pass. Tests are located alongside source files (e.g., `src/services/TextBlockSplitter.test.ts`). Mock external dependencies; this task has none.

---

### Task 1: Add `forceSplitLongParagraphs()` Method with Tests

**Objective:** Create a new private method `forceSplitLongParagraphs()` that guarantees all returned strings are ≤3000 characters, splitting at the last space or comma before the limit, with a hard cut fallback.

**Files to modify/create:**
- Modify: `src/services/TextBlockSplitter.ts` (Purpose: Add new private method `forceSplitLongParagraphs()`)
- Test: `src/services/TextBlockSplitter.test.ts` (Purpose: Add unit tests for the new method)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TextBlockSplitter.ts` to understand the class structure. The new method should be private, placed after `splitParagraphIntoSentences()` and before `isAbbreviation()`.
2. **Write Failing Test:** In `src/services/TextBlockSplitter.test.ts`, add a new `describe` block for `forceSplitLongParagraphs()`. Write tests that verify:
   - Paragraphs ≤3000 chars are returned unchanged
   - Long paragraphs split at the last space before 3000 chars
   - Long paragraphs split at comma if better than space
   - Hard cut at exactly 3000 chars if no space/comma found
   - Multiple long paragraphs are handled correctly
   - All resulting strings are trimmed (no trailing/leading whitespace)
   Run `npm test -- --run` to ensure tests fail.
3. **Implement Minimal Code:** In `src/services/TextBlockSplitter.ts`, add the `forceSplitLongParagraphs(paragraphs: string[]): string[]` private method. Use a `MAX_PARAGRAPH_CHARS` constant of 3000. For each paragraph >3000 chars, iteratively split at `lastIndexOf(' ', 3000)` or `lastIndexOf(',', 3000)` (whichever is later but >1500), otherwise hard cut at 3000. Trim each chunk.
4. **Verify:** Run `npm test` and ensure the new tests pass.
5. **Commit:** Commit with message: `feat: add forceSplitLongParagraphs guard method to TextBlockSplitter`

---

### Task 2: Integrate `forceSplitLongParagraphs()` into `splitIntoParagraphs()`

**Objective:** Modify `splitIntoParagraphs()` to call `forceSplitLongParagraphs()` on its result before returning, guaranteeing all output ≤3000 chars.

**Files to modify/create:**
- Modify: `src/services/TextBlockSplitter.ts` (Purpose: Update `splitIntoParagraphs()` to call the new guard)
- Test: `src/services/TextBlockSplitter.test.ts` (Purpose: Add integration tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the current `splitIntoParagraphs()` method (lines ~19-36). Note it currently returns the `paragraphs` array directly after building it.
2. **Write Failing Test:** In `src/services/TextBlockSplitter.test.ts`, add integration tests for `splitIntoParagraphs()` that verify:
   - A 15000-character paragraph with no punctuation is split into 5 chunks of ≤3000 chars each
   - A paragraph entirely inside quotes (e.g., `"aaa...aaa"`) is force-split correctly
   - Normal paragraphs with punctuation still work as before
   Run `npm test -- --run` to ensure tests fail.
3. **Implement Minimal Code:** Modify `splitIntoParagraphs()` to return `this.forceSplitLongParagraphs(paragraphs)` instead of returning `paragraphs` directly. Add a comment explaining this is a safety net for edge cases where `splitParagraphIntoSentences()` fails.
4. **Verify:** Run `npm test` and ensure all tests pass, including existing ones.
5. **Commit:** Commit with message: `feat: integrate forceSplitLongParagraphs guard into splitIntoParagraphs`

---

### Task 3: Remove Dead Code `splitLongSentence()`

**Objective:** Remove the `splitLongSentence()` method and its call site in `splitIntoBlocks()`, as it's now dead code (the guard ensures nothing exceeds 3000 chars at the paragraph level).

**Files to modify/create:**
- Modify: `src/services/TextBlockSplitter.ts` (Purpose: Remove `splitLongSentence()` method and its usage)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/services/TextBlockSplitter.ts` to locate `splitLongSentence()` (lines ~278-300) and its call site within `splitIntoBlocks()`. Note that `splitIntoBlocks()` calls it when a sentence's token count exceeds `maxTokens`.
2. **Remove Call Site:** In `splitIntoBlocks()`, remove the conditional block that checks `if (tokens > maxTokens)` and calls `splitLongSentence()`. This entire branch can be removed since the guard guarantees sentences ≤3000 chars (~750 tokens) before reaching this point.
3. **Remove Method:** Delete the entire `splitLongSentence()` private method.
4. **Verify:** Run `npm test` to ensure no regressions. All existing tests should pass.
5. **Commit:** Commit with message: `refactor: remove dead splitLongSentence method`

---

### Task 4: Final Verification and Cleanup

**Objective:** Run full test suite and verify no regressions, then finalize the implementation.

**Files to modify/create:**
- None (verification only)

**Instructions for Execution Agent:**
1. **Context Setup:** Review the changes made in Tasks 1-3. Ensure `splitLongSentence()` is fully removed and `forceSplitLongParagraphs()` is properly integrated.
2. **Verify:** Run `npm test` to execute the full test suite. All 62 test files should pass.
3. **Manual Edge Case Test (Optional):** If you want additional confidence, create a temporary test with a 15000-char string of only the letter 'a' and verify `splitIntoParagraphs()` returns 5 chunks of 3000 chars each.
4. **Commit:** No commit needed — this is a verification task. If tests pass, the implementation is complete.

---

## Summary of Changes

- **New method:** `forceSplitLongParagraphs(paragraphs: string[]): string[]` — private, enforces 3000-char limit
- **Modified:** `splitIntoParagraphs()` — now calls `forceSplitLongParagraphs()` before returning
- **Deleted:** `splitLongSentence()` — ~30 lines of dead code removed
- **Tests added:** ~8 new test cases covering edge cases and integration scenarios
