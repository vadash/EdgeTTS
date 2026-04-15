# Re-enqueue Failed Tasks Implementation Plan

**Goal:** Replace inline `withRetry` exponential backoff in TTSWorkerPool with immediate re-enqueuing of failed tasks, freeing worker slots to process healthy chunks during retry delays.

**Testing Conventions:** Use Vitest for unit tests with mocked network calls, WebSockets, and File System API. Global mocks for `p-retry`, `p-queue`, and `generic-pool` are configured in `src/test/setup.ts`. Tests must follow TDD red-green methodology: write failing test first, then implement minimal code to satisfy it.

---

### Task 1: Add Retry State Management Infrastructure

**Objective:** Add instance properties to track retry attempts and pending timeout timers for each task.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add retryCount and retryTimers Map properties to track retry state per task)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify retry state initialization and management)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts` to locate the constructor and property declarations (around line 49-69).
2. **Write Failing Test:** In the test file, write tests that verify:
   - `retryCount` Map is initialized as empty
   - `retryTimers` Map is initialized as empty
   - Run the test to ensure it fails (properties don't exist yet)
3. **Implement Minimal Code:** In `TTSWorkerPool.ts`, add two private properties after the existing property declarations (after line ~67):
   - `private retryCount = new Map<number, number>();`
   - `private retryTimers = new Map<number, NodeJS.Timeout>();`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add retry state tracking Maps to TTSWorkerPool`

---

### Task 2: Implement Backoff Delay Calculation

**Objective:** Extract the exponential backoff calculation into a reusable private method.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add calculateRetryDelay method for computing exponential backoff with jitter)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify delay progression and max delay cap)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts` to understand where private methods are defined (after line ~180).
2. **Write Failing Test:** In the test file, write tests that verify:
   - Delay progression: attempt 1 → ~10s, attempt 2 → ~20s, attempt 3 → ~40s, attempt 4 → ~80s, attempt 5 → ~160s
   - Max delay cap: attempts 6-11 all return ~600s (10 minutes)
   - Jitter randomness: delays vary slightly due to Math.random() (mock `vi.spyOn(Math, 'random').mockReturnValue(0.5)` for deterministic testing)
   - Run tests to ensure they fail (method doesn't exist yet)
3. **Implement Minimal Code:** Add a private method `calculateRetryDelay(attempt: number): number` that implements the formula: `Math.min(10000 * 2 ** (attempt - 1) + Math.random() * 1000, 600000)`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add exponential backoff calculation with jitter and cap`

---

### Task 3: Implement Task Re-enqueue Logic

**Objective:** Create a method to re-add failed tasks to the PQueue after their delay expires.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add requeueTask method to re-add tasks to the queue)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify tasks are re-enqueued and status updates fire)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts` to understand the queue property and onStatusUpdate callback pattern.
2. **Write Failing Test:** In the test file, write tests that verify:
   - `requeueTask` adds the task back to `this.queue`
   - `onStatusUpdate` callback fires with "Retrying now..." message
   - `retryTimers.delete` is called for the task's partIndex
   - Run tests to ensure they fail (method doesn't exist yet)
3. **Implement Minimal Code:** Add a private method `requeueTask(task: PoolTask): void` that:
   - Fires `onStatusUpdate` with retry message
   - Calls `this.queue.add(() => this.executeTask(task))`
   - Deletes the timer from `retryTimers`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add task re-enqueue method with status updates`

---

### Task 4: Implement Failure Handler with Retry Logic

**Objective:** Create a centralized handler for task failures that manages retry count, schedules retries, and handles permanent failures.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add handleTaskFailure method to manage retry state and schedule retries)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify retry state tracking, max retries enforcement, and LadderController integration)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/LadderController.ts` to understand the `recordTask` and `evaluate` methods (lines 34-80).
2. **Write Failing Test:** In the test file, write tests that verify:
   - `retryCount` increments on each failure
   - Tasks below max retries (11) schedule a timeout with correct delay
   - Tasks exceeding max retries call `ladder.recordTask(false, 11)`, `ladder.evaluate()`, add to `failedTasks`, increment `processedCount`, call `onTaskError`, and **call `retryCount.delete(task.partIndex)` to prevent memory leaks**
   - Run tests to ensure they fail (method doesn't exist yet)
3. **Implement Minimal Code:** Add a private async method `handleTaskFailure(task: PoolTask, error: unknown): Promise<void>` that:
   - Increments and updates `retryCount` for the task's partIndex
   - If attempt > 11: handle permanent failure (LadderController, failedTasks, callbacks, **cleanup: `retryCount.delete(task.partIndex)`**)
   - If attempt <= 11: calculate delay, fire status update, schedule setTimeout to call `requeueTask`, store timer in `retryTimers`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add failure handler with retry scheduling and permanent failure handling`

---

### Task 5: Refactor executeTask to Remove withRetry Wrapper

**Objective:** Replace the `withRetry` wrapper with direct try/catch, using `destroy()` on failure instead of `release()`.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Refactor executeTask to use try/catch and call handleTaskFailure)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify success path uses release(), failure path uses destroy())

**Instructions for Execution Agent:**
1. **Context Setup:** Read the current `executeTask` method implementation to understand the existing `withRetry` pattern (around line 182-285).
2. **Write Failing Test:** In the test file, write tests that verify:
   - **Post-cancellation safety:** If `this.totalTasks === 0` (pool cleared), skip all state updates and just release/destroy connection
   - On success: `connectionPool.release()` is called, **read current retry count from Map** (defaulting to 0), pass actual retry count to `ladder.recordTask(true, actualRetries)`, **then call `retryCount.delete(partIndex)` to prevent memory leaks**
   - On failure: `await this.connectionPool.destroy(service)` is called inside try/catch to handle already-dead sockets safely (NOT release), then `handleTaskFailure` is called with the error
   - Run tests to ensure they fail (current implementation uses withRetry)
3. **Implement Minimal Code:** Refactor `executeTask` to:
   - Remove `withRetry` wrapper and AbortSignal handling (now managed externally by orchestrator)
   - Use direct try/catch around `service.send()`
   - **Add post-cancellation check at start of success/failure paths:** if `this.totalTasks === 0`, skip all state updates and just clean up the connection
   - Success path: write chunk, **read actual retry count from `retryCount.get(partIndex) || 0`**, call `ladder.recordTask(true, actualRetries)`, **then call `retryCount.delete(partIndex)`**, release connection
   - Failure path: wrap `await this.connectionPool.destroy(service)` in try/catch (swallow errors if socket already dead), then call `handleTaskFailure(task, error)`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `refactor: replace withRetry with direct try/catch and destroy-on-failure`

---

### Task 6: Add Cleanup for Retry Timers

**Objective:** Clear pending retry timers in cleanup() and clear() methods to prevent ghost tasks from waking after cancellation.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add timeout clearing to cleanup() and clear() methods)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify clearTimeout is called and maps are cleared)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts` to locate the `cleanup()` (line ~327) and `clear()` (line ~347) methods.
2. **Write Failing Test:** In the test file, write tests that verify:
   - `cleanup()` clears all timers in `retryTimers` Map using `clearTimeout`
   - `cleanup()` clears both `retryTimers` and `retryCount` Maps
   - `clear()` clears all timers and both Maps
   - Run tests to ensure they fail (cleanup doesn't handle timers yet)
3. **Implement Minimal Code:** In both `cleanup()` and `clear()` methods, before existing cleanup logic:
   - Loop through `retryTimers.values()` and call `clearTimeout` on each timer
   - Call `retryTimers.clear()`
   - Call `retryCount.clear()`
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: clear retry timers on cleanup and cancellation`

---

### Task 7: Add Integration Tests for Network Failure Simulation

**Objective:** Create integration tests that simulate batch network failures to verify workers stay free and healthy chunks process during retries.

**Files to modify/create:**
- Create: `src/services/TTSWorkerPool.retry.integration.test.ts` (Purpose: Integration tests for retry behavior under network failure conditions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.test.ts` to understand the test helpers (createPool, createTask) and mock patterns.
2. **Write Failing Test:** Create a new integration test file with tests that verify:
   - When multiple tasks fail simultaneously, workers are not blocked (queue concurrency is available)
   - Healthy tasks continue processing while failed tasks are in retry timers
   - After retry delay expires, failed tasks are re-executed
   - Status updates fire at expected times (failure, retry delay, re-execution)
   - Run tests to ensure they pass with the new implementation
3. **Implement Minimal Code:** No implementation code needed - this is a test-only task to validate the feature works end-to-end.
4. **Verify:** Run the integration tests and ensure they pass.
5. **Commit:** Commit with message: `test: add integration tests for retry behavior under network failures`

---

### Task 8: Update Documentation and Manual Testing

**Objective:** Update relevant documentation and perform manual testing with real conversion.

**Files to modify/create:**
- Modify: `docs/designs/2026-04-15-requeue-failed-tasks.md` (Purpose: Update implementation checklist status)
- Modify: `src/services/CLAUDE.md` (Purpose: Document retry behavior and cleanup requirements)
- Manual: Run actual conversion with simulated network issues (Purpose: Verify real-world behavior)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the design doc's implementation checklist and any existing service documentation.
2. **Update Documentation:**
   - Mark all checklist items as complete in the design doc
   - Add retry behavior section to `src/services/CLAUDE.md` documenting the re-enqueue approach, cleanup requirements, and differences from old withRetry behavior
3. **Manual Testing:**
   - Run a real conversion with network throttling or intermittent connectivity
   - Monitor logs for "Retrying in Xs" and "Retrying now..." messages
   - Verify healthy chunks complete during retry delays
   - Verify no worker starvation occurs
4. **Verify:** Confirm documentation is accurate and manual testing passes.
5. **Commit:** Commit with message: `docs: update design doc and service docs with retry implementation details`

---

## Task Dependencies

- Task 1 must complete first (adds infrastructure)
- Task 2 depends on Task 1 (uses retryCount for calculation)
- Task 3 depends on Task 1 (uses queue and retryTimers)
- Task 4 depends on Tasks 1-3 (uses all retry infrastructure)
- Task 5 depends on Task 4 (calls handleTaskFailure)
- Task 6 depends on Task 4 (cleans up timers created by handleTaskFailure)
- Task 7 depends on Task 5 (tests the full refactored flow)
- Task 8 depends on Task 7 (validates complete implementation)

## Implementation Notes

- **Critical:** Always call `await this.connectionPool.destroy(service)` on failure (never `release()`), wrapped in try/catch to handle already-dead sockets
- **Critical:** Always clear timers in `cleanup()` and `clear()` to prevent ghost tasks
- **Critical:** Always call `retryCount.delete(task.partIndex)` on BOTH success and permanent failure paths to prevent memory leaks in large conversions (100k+ chunks)
- **LadderController integration:** Record actual retry count on success (`retryCount.get(partIndex) || 0`), record 11 on permanent failure, never record intermediate retries
- **Post-cancellation safety:** Check `this.totalTasks === 0` before updating state in `executeTask` - if pool was cleared, skip all callbacks and counters, just clean up the connection
- **Status updates:** Fire twice during retry cycle - once on failure (delay info) and once on re-execution
- **In-memory state:** Retry state is lost on page refresh - this is acceptable per requirements
- **Testing:** Mock `Math.random()` with `vi.spyOn(Math, 'random').mockReturnValue(0.5)` for deterministic delay calculations in tests
