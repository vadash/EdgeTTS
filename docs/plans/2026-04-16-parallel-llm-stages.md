# Parallel LLM Stages Implementation Plan

**Goal:** Replace sequential/batched LLM calls in Extract and Assign stages with a shared `runWithConcurrency` helper backed by `p-queue`, keeping Merge unchanged.
**Testing Conventions:** Vitest + jsdom. TDD red-green. Global mocks for `p-queue` and `p-retry` in `src/test/setup.ts` (execute immediately). Each task gets its own test file. Run via `npm test`.

---

### Task 1: Create `runWithConcurrency` helper and tests

**Objective:** Build and test the shared concurrency utility that Extract and Assign will both use.

**Files to modify/create:**
- Create: `src/services/llm/runWithConcurrency.ts` (Purpose: shared PQueue-backed concurrency helper + `ConcurrencyOptions` interface)
- Create: `src/services/llm/runWithConcurrency.test.ts` (Purpose: unit tests for the helper)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the existing PQueue mock in `src/test/setup.ts` (lines 17–30ish) to understand how PQueue is mocked in tests — it executes tasks immediately with no real concurrency. This means the tests for `runWithConcurrency` need to **override** the global mock by importing `p-queue` and using `vi.mock` locally, OR test with the real PQueue by unmocking it for this test file. Decide which approach gives meaningful coverage.
2. **Write Failing Tests:** In `runWithConcurrency.test.ts`, write tests that verify:
   - All tasks execute and results are returned in input order.
   - Progress callback fires once per completed task with correct `(completed, total)` values.
   - If `signal` is already aborted before any task runs, the function throws `'Operation cancelled'`.
   - If a task throws, the overall promise rejects with that error.
   - Concurrency limit is respected (no more than `concurrency` tasks running simultaneously). This test requires the real PQueue — use `vi.unmock('p-queue')` at the top of this test file and create tasks that track active concurrency via a shared counter.
   - Empty task array returns empty results.
3. **Implement Minimal Code:** In `runWithConcurrency.ts`, export `ConcurrencyOptions` interface and `runWithConcurrency<T>` function. The function takes an array of `() => Promise<T>` thunks and `ConcurrencyOptions`, creates a `PQueue({ concurrency })`, adds all tasks via `queue.add()`, checks `signal.aborted` at task start, increments a completed counter and calls `onProgress` after each task, and returns results via `Promise.all`. Preserve result order (Promise.all does this naturally).
4. **Verify:** Run `npm test -- src/services/llm/runWithConcurrency.test.ts` and ensure all tests pass.
5. **Commit:** Commit with message: `feat: add runWithConcurrency helper for parallel LLM stages`

---

### Task 2: Refactor `extractCharacters` to use `runWithConcurrency`

**Objective:** Replace the sequential `for` loop in `extractCharacters` with the shared concurrency helper. Extract the loop body into a private `extractBlock` method.

**Files to modify/create:**
- Modify: `src/services/llm/LLMVoiceService.ts` (Purpose: refactor `extractCharacters`, add private `extractBlock` method)
- Test: `src/services/llm/extract.test.ts` (Purpose: existing tests should pass unchanged; run them to verify)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full source of `extractCharacters` method (lines 193–276) and the `LLMVoiceServiceOptions` interface (lines 101–127) in `src/services/llm/LLMVoiceService.ts`. Also read `runWithConcurrency.ts` from Task 1 to understand the helper's API.
2. **Write Failing Tests:** No new test file needed. The existing `src/services/llm/extract.test.ts` must continue to pass. Run it first to establish the baseline: `npm test -- src/services/llm/extract.test.ts`.
3. **Implement Minimal Code:**
   - Add `import { runWithConcurrency } from './runWithConcurrency';` at the top of `LLMVoiceService.ts`.
   - Extract the loop body of `extractCharacters` (everything inside the `for (let i = 0; i < blocks.length; i++)` loop) into a new private method `extractBlock(block: TextBlock, index: number, total: number, controller: AbortController): Promise<{ characters: LLMCharacter[]; debugLog?: { messages: object; response: object } }>`. The method returns the LLM response plus optional debug log data (only when `index === 0`).
   - The new `extractBlock` method should:
     - Join `block.sentences` into text.
     - Call `buildExtractPrompt` with the block text, `this.detectedLanguage`, `this.options.repeatPrompt`.
     - Call `withRetry` wrapping `this.apiClient.callStructured` with `ExtractSchema`, same retry config and signal as before.
     - If `index === 0`, collect the debug log data instead of calling `savePhaseLog` directly (the caller will handle saving).
     - Return `{ characters: response.characters, debugLog?: { messages, response } }`.
   - Replace the loop in `extractCharacters` with:
     - Map `blocks` to an array of `() => this.extractBlock(block, i, blocks.length, controller)` thunks.
     - Call `runWithConcurrency(tasks, { concurrency: this.options.maxConcurrentRequests ?? 2, signal: controller.signal, onProgress: (completed, total) => onProgress?.(completed, total) })`.
     - Iterate the responses: push all `characters` into `allCharacters`; if `responses[0].debugLog` exists, call `savePhaseLog('extract', ...)` once.
   - Remove the `LLM_DELAY_MS` delay logic (no longer needed — PQueue manages flow).
   - The post-processing (`mergeCharacters`, `cullByFrequency`, `mergeCharactersWithLLM`) remains unchanged.
4. **Verify:** Run `npm test -- src/services/llm/extract.test.ts` and ensure all tests pass. Also run the full suite: `npm test`.
5. **Commit:** Commit with message: `feat: parallelize Extract stage with runWithConcurrency`

---

### Task 3: Refactor `assignSpeakers` and `processAssignBlock` to use `runWithConcurrency`

**Objective:** Replace the batched `for + Promise.all` in `assignSpeakers` with the shared helper. Fix the `isFirstAssignBlock` race condition by replacing the mutable field with an `isFirstBlock` parameter.

**Files to modify/create:**
- Modify: `src/services/llm/LLMVoiceService.ts` (Purpose: refactor `assignSpeakers`, update `processAssignBlock` signature)
- Test: `src/services/llm/assign.test.ts` (Purpose: existing tests should pass)
- Test: `src/services/llm/assignWithQA.test.ts` (Purpose: existing tests should pass — covers QA pass path)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full source of `assignSpeakers` (lines 281–353) and `processAssignBlock` (lines 360–534) in `src/services/llm/LLMVoiceService.ts`. These are the two methods being changed. Also read the class fields (lines 132–140) to see the `isFirstAssignBlock` field that will be removed.
2. **Write Failing Tests:** No new test file needed. Run existing tests first to establish baseline: `npm test -- src/services/llm/assign.test.ts src/services/llm/assignWithQA.test.ts`.
3. **Implement Minimal Code:**
   - **Remove `isFirstAssignBlock` field** from the class (line 138: `private isFirstAssignBlock: boolean = true;`).
   - **Remove the reset** in `assignSpeakers` (line 296: `this.isFirstAssignBlock = true;`).
   - **Add `isFirstBlock: boolean` parameter** to `processAssignBlock` signature (after the existing `overlapSentences` parameter).
   - **Replace all `this.isFirstAssignBlock` checks** in `processAssignBlock` with the new `isFirstBlock` parameter. Remove all `this.isFirstAssignBlock = false;` assignments. There are 4 occurrences of the check (lines ~426, 476, 495, 503) and 3 assignments to `false` (lines ~482, 496, 504). The parameter is a local boolean — no mutation needed.
   - **Refactor `assignSpeakers`:**
     - Remove the entire batched `for` loop and `LLM_DELAY_MS` delay.
     - Build the task array: `blocks.map((block, globalIndex) => () => { ... })` where each thunk computes `overlapSentences` from `blocks[globalIndex - 1]` (same logic as before), then calls `this.processAssignBlock(block, characterVoiceMap, characters, nameToCode, codeToName, overlapSentences, globalIndex === 0)`.
     - Call `runWithConcurrency(tasks, { concurrency: maxConcurrent, signal: this.abortController.signal, onProgress: (completed, total) => onProgress?.(completed, total) })`.
     - Flatten results with `.flat()` and sort by `sentenceIndex` (same as before).
     - Remove the `let completed = 0` counter and the manual progress tracking — `runWithConcurrency` handles this.
4. **Verify:** Run `npm test -- src/services/llm/assign.test.ts src/services/llm/assignWithQA.test.ts` and ensure all pass. Run full suite: `npm test`.
5. **Commit:** Commit with message: `feat: parallelize Assign stage with runWithConcurrency, fix isFirstBlock race`

---

### Task 4: Cleanup and full regression

**Objective:** Remove unused constants, verify all tests pass, and confirm no regressions.

**Files to modify/create:**
- Modify: `src/services/llm/LLMVoiceService.ts` (Purpose: remove `LLM_DELAY_MS` constant if no longer referenced anywhere in the file)

**Instructions for Execution Agent:**
1. **Context Setup:** Search for all references to `LLM_DELAY_MS` in `src/services/llm/LLMVoiceService.ts`. After Tasks 2 and 3 removed both usage sites (Extract delay and Assign batch delay), the constant should be unused within the file. Check if any other file imports it — it's a file-scoped `const`, not exported, so it's safe to remove if unused in the same file.
2. **Write Failing Tests:** No new tests. This is cleanup only.
3. **Implement Minimal Code:**
   - If `LLM_DELAY_MS` (line 86) has zero remaining references in the file, delete the constant declaration.
   - Run `npm run typecheck` to verify no type errors.
4. **Verify:** Run the full test suite: `npm test`. All 770+ tests should pass.
5. **Commit:** Commit with message: `refactor: remove unused LLM_DELAY_MS constant`
