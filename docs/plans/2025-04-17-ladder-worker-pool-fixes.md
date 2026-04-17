# LadderController & Worker Pool Fixes Implementation Plan

**Goal:** Fix the LadderController hysteresis bug (thrashing), expose worker concurrency stats to the UI, and hide the "Retrying now..." log message.

**Testing Conventions:** Vitest-based test suites with TDD workflow (write failing tests first, then implement). All tests must mock external network calls and File System API. Run `npm test` for unit tests.

---

### Task 1: Fix LadderController Hysteresis Bug

**Objective:** Add a `resetMetrics()` helper to clear the history array after scale up/down events, preventing the ladder from immediately re-evaluating with stale data.

**Files to modify/create:**
- Modify: `src/services/LadderController.ts` (Purpose: Add `resetMetrics()` method and call it after scale events in `evaluate()`)
- Test: `src/services/LadderController.test.ts` (Purpose: Verify history is cleared after scale events and that scale-up followed by new task doesn't trigger immediate scale-down)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `LadderController.ts` to see the `evaluate()`, `scaleUp()`, and `scaleDown()` methods.
2. **Write Failing Test:** In `LadderController.test.ts`, write a test that:
   - Creates a `LadderController` with sample size of 3
   - Records 3 successes (triggers scale up)
   - Verifies `history.length === 0` after scale up
   - Records 2 more mixed results and verifies no immediate scale-down occurs
3. **Implement Minimal Code:**
   - Add `private resetMetrics(): void` method that sets `this.history = []` and `this.tasksSinceLastScaleUp = 0`
   - Call `this.resetMetrics()` after `scaleUp()` and `scaleDown()` calls in `evaluate()`
4. **Verify:** Run `npm test -- LadderController.test.ts` and ensure tests pass.
5. **Commit:** Commit with message: `fix: clear LadderController history after scale events to prevent thrashing`

---

### Task 2: Make Ladder Aware of Intermediate Failures

**Objective:** Update `handleTaskFailure` in `TTSWorkerPool` to record intermediate retry failures to the ladder, so it can throttle down immediately when rate limits occur.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Call `ladder.recordTask(false, attempt)` and `ladder.evaluate()` on every failure, not just permanent ones)
- Test: `src/services/TTSWorkerPool.ladder.test.ts` (Purpose: Verify ladder receives failure records for intermediate retries)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `TTSWorkerPool.ts`, focusing on `handleTaskFailure` method around line 346.
2. **Write Failing Test:** In `TTSWorkerPool.ladder.test.ts`, write a test that:
   - Creates a mock `LadderController`
   - Simulates a task failure with retry count < 5
   - Verifies `ladder.recordTask(false, attempt)` was called
   - Verifies `ladder.evaluate()` was called
3. **Implement Minimal Code:**
   - In `handleTaskFailure`, after calculating `attempt`, add:
     - `this.ladder.recordTask(false, attempt)`
     - `this.ladder.evaluate()`
     - `this.queue.concurrency = this.ladder.getCurrentWorkers()`
   - Note: This happens BEFORE the `if (attempt > 5)` check
4. **Verify:** Run `npm test -- TTSWorkerPool.ladder.test.ts` and ensure tests pass.
5. **Commit:** Commit with message: `fix: record intermediate failures to ladder for immediate throttling`

---

### Task 3: Add Concurrency Change Callback

**Objective:** Add `onConcurrencyChange` callback to `WorkerPoolOptions` and emit it whenever concurrency changes.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add `onConcurrencyChange` to `WorkerPoolOptions` interface and call it when concurrency changes in `warmup()` and `executeTask()`)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify callback is invoked with correct concurrency values)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `TTSWorkerPool.ts`, focusing on `WorkerPoolOptions` type and `warmup()` and `executeTask()` methods.
2. **Write Failing Test:** In `TTSWorkerPool.test.ts`, write a test that:
   - Creates a `TTSWorkerPool` with an `onConcurrencyChange` mock callback
   - Triggers warmup or a task execution
   - Verifies the callback was called with the expected concurrency number
3. **Implement Minimal Code:**
   - Add `onConcurrencyChange?: (concurrency: number) => void` to `WorkerPoolOptions` interface
   - In `warmup()` after setting `this.queue.concurrency`, call `this.options.onConcurrencyChange?.(this.queue.concurrency)`
   - In `executeTask()` success block after setting concurrency, call the callback similarly
   - In `handleTaskFailure()` after setting concurrency, call the callback
4. **Verify:** Run `npm test -- TTSWorkerPool.test.ts` and ensure tests pass.
5. **Commit:** Commit with message: `feat: add onConcurrencyChange callback to TTSWorkerPool`

---

### Task 4: Add Active Worker Tracking to ConversionStore

**Objective:** Add `activeLlmWorkers` and `activeTtsWorkers` state fields and a setter function to the ConversionStore.

**Files to modify/create:**
- Modify: `src/stores/ConversionStore.ts` (Purpose: Add state fields, computed exports, and `setConcurrencyStats` setter)
- Test: `src/stores/ConversionStore.test.ts` (Purpose: Verify new fields and setter work correctly)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `ConversionStore.ts` to see existing state structure and pattern for adding new fields.
2. **Write Failing Test:** In `ConversionStore.test.ts`, write a test that:
   - Calls `setConcurrencyStats(4, 8)`
   - Verifies `activeLlmWorkers.value === 4`
   - Verifies `activeTtsWorkers.value === 8`
   - Calls `setConcurrencyStats(0, 0)` and verifies reset
3. **Implement Minimal Code:**
   - Add `activeLlmWorkers: number` and `activeTtsWorkers: number` to `ConversionState` interface
   - Add `activeLlmWorkers: 0` and `activeTtsWorkers: 0` to `defaultState`
   - Add computed exports: `export const activeLlmWorkers = computed(() => conversion.value.activeLlmWorkers)` and same for TTS
   - Add function `setConcurrencyStats(llm: number, tts: number): void` that calls `patchState({ activeLlmWorkers: llm, activeTtsWorkers: tts })`
4. **Verify:** Run `npm test -- ConversionStore.test.ts` and ensure tests pass.
5. **Commit:** Commit with message: `feat: add active worker tracking to ConversionStore`

---

### Task 5: Wire Concurrency Callbacks in Orchestrator

**Objective:** Wire up the `onConcurrencyChange` callback in the Orchestrator to update the store with LLM and TTS worker counts.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: Set initial LLM concurrency, pass `onConcurrencyChange` callback to worker pool)
- Test: `src/services/__tests__/ConversionOrchestrator.test.ts` (Purpose: Verify store receives concurrency updates)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `ConversionOrchestrator.ts`, focusing on `runConversion` and `runTTSStage` functions. Find where `workerPoolFactory.create` is called.
2. **Write Failing Test:** In `ConversionOrchestrator.test.ts`, write a test that:
   - Mocks the worker pool factory to capture the options passed to `create()`
   - Verifies `onConcurrencyChange` callback is passed
   - Calls the callback and verifies store receives the update
3. **Implement Minimal Code:**
   - In `runConversion`, before starting LLM stage, call `stores.conversion.setConcurrencyStats(input.llmThreads, 0)`
   - In `runTTSStage`, where `workerPoolFactory.create` is called, add the `onConcurrencyChange` callback:
     ```typescript
     onConcurrencyChange: (concurrency) => {
       _stores.conversion.setConcurrencyStats(0, concurrency);
     }
     ```
4. **Verify:** Run `npm test -- ConversionOrchestrator.test.ts` and ensure tests pass.
5. **Commit:** Commit with message: `feat: wire concurrency change callbacks in orchestrator`

---

### Task 6: Update ProgressBar Component with Worker Badges

**Objective:** Add `llmWorkers` and `ttsWorkers` props to `ProgressBar` and display them as badges in the UI.

**Files to modify/create:**
- Modify: `src/components/status/ProgressBar.tsx` (Purpose: Add props and render worker count badges)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `ProgressBar.tsx` to see current props and render structure.
2. **Write Failing Test:** In `ProgressBar.test.tsx`, write a test that:
   - Renders `ProgressBar` with `llmWorkers={4}`
   - Verifies "LLM: 4" text is present
   - Renders with `ttsWorkers={8}`
   - Verifies "TTS: 8" text is present
3. **Implement Minimal Code:**
   - Add `llmWorkers?: number` and `ttsWorkers?: number` to `ProgressBarProps`
   - Destructure in function signature with defaults of 0
   - In the JSX, after the percentage display, add a conditional badge:
     ```tsx
     {(llmWorkers > 0 || ttsWorkers > 0) && (
       <span className="ml-2 px-2 py-0.5 rounded bg-surface-alt border border-border text-gray-400">
         {llmWorkers > 0 ? `LLM: ${llmWorkers}` : `TTS: ${ttsWorkers}`}
       </span>
     )}
     ```
4. **Verify:** Run `npm test -- ProgressBar.test.tsx` and ensure tests pass.
5. **Commit:** Commit with message: `feat: display active worker counts in ProgressBar`

---

### Task 7: Wire Worker Stats to StatusPanel

**Objective:** Import the worker computed values and pass them to `ProgressBar` from `StatusPanel`.

**Files to modify/create:**
- Modify: `src/components/status/StatusPanel.tsx` (Purpose: Import `activeLlmWorkers` and `activeTtsWorkers`, pass to `ProgressBar`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `StatusPanel.tsx` to see current imports and how it renders `ProgressBar`.
2. **Write Failing Test:** Create/extend test file for `StatusPanel.tsx` to verify worker counts are passed to `ProgressBar`.
3. **Implement Minimal Code:**
   - Add import: `import { activeLlmWorkers, activeTtsWorkers } from '@/stores/ConversionStore'`
   - Pass the values to `ProgressBar`: `llmWorkers={activeLlmWorkers.value}` and `ttsWorkers={activeTtsWorkers.value}`
4. **Verify:** Run `npm test` and ensure tests pass.
5. **Commit:** Commit with message: `feat: wire worker stats to StatusPanel`

---

### Task 8: Hide "Retrying now..." Log Message

**Objective:** Move the "Retrying now..." log message to debug level or remove it entirely.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Change or remove the "Retrying now..." log line)

**Instructions for Execution Agent:**
1. **Context Setup:** Search for "Retrying now" in `TTSWorkerPool.ts` to find the exact location.
2. **Implement Change:**
   - Either change the log level to debug: `this.options.logger?.debug('Retrying now...')`
   - Or remove the line entirely if it's too noisy
3. **Verify:** Run `npm test -- TTSWorkerPool` and ensure tests pass.
4. **Commit:** Commit with message: `chore: move "Retrying now..." log to debug level`

---

## Summary of Expected Behavior After Fixes

1. **Ladder Hysteresis Fixed:** After scaling up or down, the history is cleared, preventing immediate re-evaluation with stale data.
2. **Immediate Throttling:** When Edge TTS drops a connection, the ladder records the failure immediately and scales down workers before the task permanently fails.
3. **UI Visibility:** The ProgressBar displays active worker counts (e.g., "LLM: 4" during extraction, "TTS: 8" during conversion), giving users visibility into concurrency scaling.
4. **Cleaner Logs:** The "Retrying now..." message no longer appears at info level, reducing log noise.
