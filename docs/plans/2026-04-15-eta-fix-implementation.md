# ETA Fix Implementation Plan

**Goal:** Fix broken ETA calculation across all pipeline stages by making `setStatus()` idempotent, adding `phaseStartProgress` baseline, and correcting the rate calculation math.

**Testing Conventions:** Vitest-based tests with mocked time using `vi.spyOn(Date, 'now')`. Tests for ETA calculations should verify formatted duration strings (e.g., `'00:01:30'`). Each test must call `vi.restoreAllMocks()` after.

---

### Task 1: Add `phaseStartProgress` to ConversionState

**Objective:** Add the new `phaseStartProgress` field to track the baseline progress count for velocity calculation, enabling proper ETA handling when resuming from cache.

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.ts` (Purpose: Add `phaseStartProgress` to `ConversionState` interface and `defaultState`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `ConversionState` interface and `defaultState` constant in `src/stores/ConversionStore.ts`.
2. **Add Field:** Add `phaseStartProgress: number` to the `ConversionState` interface (around line 37-52).
3. **Initialize:** Add `phaseStartProgress: 0` to the `defaultState` constant (around line 53-68).
4. **Verify:** Run `npm test -- --run src/stores/ConversionStore.test.ts` to ensure the store still initializes correctly.
5. **Commit:** Commit with message: `feat: add phaseStartProgress field to ConversionState`

---

### Task 2: Make `setStatus()` Idempotent

**Objective:** Fix the critical bug where `setStatus()` resets `phaseStartTime` on every call, even when status hasn't changed, causing elapsed time to be ~0ms.

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.ts` (Purpose: Add early return guard and initialize `phaseStartProgress` when entering processing status)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `setStatus()` function in `src/stores/ConversionStore.ts` (around line 177-190).
2. **Add Guard:** Add an early return at the start of `setStatus()`: `if (conversion.value.status === status) return;`
3. **Initialize Baseline:** When entering a processing status (where `isProcessingStatus(status)` is true), also set `phaseStartProgress: 0` in the new state.
4. **Write Failing Test:** Before implementing, add a test in `src/stores/ConversionStore.test.ts` that:
   - Sets status to `'converting'`
   - Advances mocked time
   - Calls `setStatus('converting')` again (same status)
   - Verifies `phaseStartTime` has NOT been reset (i.e., ETA calculation still uses original start time)
   - Run the test to confirm it fails
5. **Implement:** Apply the idempotent guard to `setStatus()`.
6. **Verify:** Run tests to confirm the new test passes and existing tests still pass.
7. **Commit:** Commit with message: `fix: make setStatus idempotent to prevent timer resets`

---

### Task 3: Fix ETA Calculation Math

**Objective:** Correct the rate calculation to exclude `failed` from the denominator (since `current` already tracks successful items only) and use `phaseStartProgress` baseline for velocity calculation.

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.ts` (Purpose: Rewrite `estimatedTimeRemaining` computed signal)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `estimatedTimeRemaining` computed signal in `src/stores/ConversionStore.ts` (around line 113-140).
2. **Understand Current Logic:** The current implementation has:
   - `successfulCurrent = current - failed` (problematic when failures == successes)
   - `remainingItems = total - current - failed` (also problematic)
3. **Write Failing Test:** Update the test `'excludes failed chunks from remaining work estimate'` in `src/stores/ConversionStore.test.ts`:
   - Current expectation: `'00:01:25'` (based on wrong math: 85 remaining * 1s/item)
   - New expectation: `'00:01:30'` (correct math: 90 remaining * 1s/item, since current=10 successful in 10s)
   - Run the test to confirm it fails with the current implementation.
4. **Implement:** Rewrite `estimatedTimeRemaining` to:
   - Use `const { current, total } = conversion.value.progress` (ignore `failed`)
   - Get `baseline = conversion.value.phaseStartProgress`
   - Calculate `processed = current - baseline`
   - Calculate `timePerItem = elapsed / processed`
   - Calculate `remainingItems = total - current`
   - Return `formatDuration(remainingItems * timePerItem)`
   - Include proper guards: `if (!start || total === 0 || current === 0 || current >= total) return null;`
   - Add guard: `if (processed <= 0) return null;`
5. **Verify:** Run tests to confirm the updated test passes.
6. **Commit:** Commit with message: `fix: correct ETA calculation math using phaseStartProgress baseline`

---

### Task 4: Add `setPhaseBaseline` Helper Function

**Objective:** Export a helper to set the `phaseStartProgress` baseline when resuming from cache (e.g., when 8725 chunks are already cached, we should ignore them for velocity calculation).

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.ts` (Purpose: Add `setPhaseBaseline` function)
- Modify: `src/stores/index.ts` (Purpose: Export `setPhaseBaseline`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the exports and helper functions in `src/stores/ConversionStore.ts`.
2. **Implement:** Add a new exported function `setPhaseBaseline(count: number): void` that calls `patchState({ phaseStartProgress: count })`.
3. **Export:** Add `setPhaseBaseline` to the exports in `src/stores/index.ts`.
4. **Write Test:** Add a test in `src/stores/ConversionStore.test.ts` that:
   - Starts conversion and sets status
   - Calls `setPhaseBaseline(100)`
   - Verifies `conversion.value.phaseStartProgress` is 100
   - Updates progress with current=100 (equal to baseline)
   - Verifies ETA is null (since processed = 0)
5. **Verify:** Run tests to confirm the new helper works correctly.
6. **Commit:** Commit with message: `feat: add setPhaseBaseline helper for resume handling`

---

### Task 5: Create Unified `report()` Helper in Orchestrator

**Objective:** Refactor the `runConversion` function to use a unified `report()` helper that consolidates logging, status updates, and progress tracking in one place.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: Extend the existing `report()` helper to also handle progress updates)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `runConversion` function and its inner `report` helper in `src/services/ConversionOrchestrator.ts` (around line 483-488).
2. **Refactor:** Modify the existing `report` helper from:
   ```typescript
   const report = (stage: string, _current: number, _total: number, message: string) => {
     logger.info(message);
     updateStatus(stage, stores);
   };
   ```
   To:
   ```typescript
   const report = (stage: string, current: number, total: number, message: string, failed = 0) => {
     logger.info(message);
     updateStatus(stage, stores);
     if (total > 0) {
       updateProgress(current, total, failed);
     }
   };
   ```
3. **Find Callers:** Locate all places in `runConversion` and `runTTSStage` that call `updateProgress` separately and refactor them to use the unified `report()` helper instead.
4. **Verify:** Run `npm test -- --run` to ensure no regressions.
5. **Commit:** Commit with message: `refactor: use unified report helper for progress tracking`

---

### Task 6: Add Resume Handling for TTS Stage

**Objective:** When resuming TTS conversion from cache, set the baseline to ignore cached chunks for ETA calculation, preventing impossible velocity calculations.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: Call `setPhaseBaseline` when resuming TTS with cached chunks)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the TTS stage logic in `runTTSStage` function in `src/services/ConversionOrchestrator.ts`, specifically where `audioMap.size > 0` (around line 880-890).
2. **Find Resume Location:** Locate where the code detects existing cached chunks:
   ```typescript
   if (audioMap.size > 0) {
     logger.info(`Resuming: found ${audioMap.size}/${chunks.length} cached chunks`);
   }
   ```
3. **Add Baseline Call:** Before or alongside the resume log message, add:
   ```typescript
   stores.conversion.setPhaseBaseline(audioMap.size);
   ```
4. **Verify:** The code should now properly set the baseline when resuming.
5. **Commit:** Commit with message: `feat: set phase baseline when resuming TTS from cache`

---

### Task 7: Fix `updateStatus()` Progress Reset Bug

**Objective:** Remove the redundant `updateProgress(0, 0)` call in `updateStatus()` for the `'tts-conversion'` case that was resetting progress.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: Remove progress reset in `updateStatus`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `updateStatus` function in `src/services/ConversionOrchestrator.ts` (around line 1063-1100).
2. **Find Bug:** Locate the `'tts-conversion'` case:
   ```typescript
   case 'tts-conversion':
     conversion.setStatus('converting');
     llm.setProcessingStatus('idle');
     conversion.updateProgress(0, 0);  // <-- REMOVE THIS LINE
     break;
   ```
3. **Remove Reset:** Delete the `conversion.updateProgress(0, 0);` line.
4. **Verify:** Run `npm test -- --run` to ensure no regressions.
5. **Commit:** Commit with message: `fix: remove progress reset in updateStatus for tts-conversion`

---

### Task 8: Update Test Expectations

**Objective:** Update the ETA calculation test to match the corrected math (current now tracks successful items only, excluding failed from calculations).

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.test.ts` (Purpose: Update test expectations for new ETA math)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the `'excludes failed chunks from remaining work estimate'` test in `src/stores/ConversionStore.test.ts` (around line 263-280).
2. **Update Test:** Change the test to reflect the corrected calculation:
   - Current test: expects `'00:01:25'` (based on wrong math: remaining = 100 - 10 - 5 = 85)
   - Update to: expects `'00:01:30'` (correct math: remaining = 100 - 10 = 90)
3. **Update Comment:** Update the comment in the test to explain the new math:
   ```typescript
   // 10 items processed in 10 seconds = 1s/item
   // Remaining items: 100 - 10 = 90
   // ETA: 90 * 1s = 90s = 00:01:30
   ```
4. **Verify:** Run `npm test -- --run src/stores/ConversionStore.test.ts` to confirm the test passes with the new implementation.
5. **Commit:** Commit with message: `test: update ETA test expectations for corrected math`

---

## Task Dependency Chain

- **Task 1** (Add field) must complete before Tasks 2, 3, 4
- **Task 2** (Idempotent setStatus) must complete before Task 3
- **Task 4** (setPhaseBaseline) must complete before Task 6
- **Task 3** (Fix ETA math) must complete before Task 8
- Tasks 5, 6, 7 can be done in parallel after Task 4

## Verification Checklist

After all tasks complete:
- [ ] `npm test -- --run` passes all tests
- [ ] `npm run check` passes (lint and typecheck)
- [ ] ETA shows reasonable estimates during LLM Extract phase
- [ ] ETA shows reasonable estimates during LLM Assign phase
- [ ] ETA shows reasonable estimates during TTS Conversion phase
- [ ] ETA shows reasonable estimates during FFmpeg Merge phase
- [ ] Resuming from large cache (e.g., 8725 chunks) shows sensible ETA (not 00:00:00)
