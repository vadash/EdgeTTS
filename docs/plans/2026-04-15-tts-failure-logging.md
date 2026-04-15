# TTS Failure Logging Implementation Plan

**Goal:** Log chunk content and error message when a TTS chunk fails permanently (after 11 retries).

**Testing Conventions:** Vitest-based unit tests with mocks for File System API (`createMockDirectoryHandle` from `src/test/mocks/FileSystemMocks.ts`). Tests must mock all external dependencies. Use `vi.fn()` spies and `vi.spyOn()` for method interception. Global mocks for `p-retry`, `p-queue`, and `generic-pool` are already configured in `src/test/setup.ts`.

---

### Task 1: Add `directoryHandle` to `WorkerPoolOptions` interface

**Objective:** Extend the `WorkerPoolOptions` interface to accept an optional `directoryHandle` parameter, which will be used for writing TTS failure logs.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add `directoryHandle` field to `WorkerPoolOptions` interface)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify the interface accepts the new field)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts` to locate the `WorkerPoolOptions` interface (around line 26).
2. **Write Failing Test:** In `src/services/TTSWorkerPool.test.ts`, write a test that verifies `TTSWorkerPool` can be instantiated with a `directoryHandle` option. Use `createMockDirectoryHandle()` from `src/test/mocks/FileSystemMocks.ts` to create a mock handle. Run the test to ensure it fails (the field doesn't exist yet).
3. **Implement Minimal Code:** Add `directoryHandle?: FileSystemDirectoryHandle | null;` to the `WorkerPoolOptions` interface in `src/services/TTSWorkerPool.ts`. Store it in the constructor as `this.options.directoryHandle`.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add directoryHandle to WorkerPoolOptions interface`

---

### Task 2: Add `logTTSFailure` private method to `TTSWorkerPool`

**Objective:** Implement a private method that writes failure log entries to `logs/tts_fail*.json` files in the directory handle.

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add `logTTSFailure` private method and `failureLogCounter` property)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify log file creation with correct content)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `TTSWorkerPool` class to understand the constructor and existing private methods.
2. **Write Failing Test:** In `src/services/TTSWorkerPool.test.ts`, write a test that:
   - Creates a pool with a mock `directoryHandle`
   - Triggers a permanent failure (after 11 retries)
   - Verifies that `getFileHandle` was called with `'logs'` and `tts_fail1.json`
   - Verifies the written JSON contains: `partIndex`, `text`, `errorMessage`, `retryCount: 11`, and `timestamp`
   - Also verify no file is created when `directoryHandle` is null
   Use `vi.spyOn()` to mock `getDirectoryHandle` and `getFileHandle` methods on the directory handle. Run the test to ensure it fails (method doesn't exist yet).
3. **Implement Minimal Code:** In `TTSWorkerPool` class:
   - Add private property: `private failureLogCounter = 0;`
   - Add private method `logTTSFailure(task: PoolTask, error: unknown): Promise<void>` that:
     - Returns early if `!this.options.directoryHandle`
     - Gets/creates `'logs'` subdirectory via `getDirectoryHandle('logs', { create: true })`
     - Increments `this.failureLogCounter`
     - Creates file `tts_fail${this.failureLogCounter}.json`
     - Writes JSON with fields: `partIndex`, `text`, `errorMessage` (from Error.message or String(error)), `retryCount: 11`, `timestamp` (ISO string)
     - Wraps in try/catch, calling `this.logger?.warn()` on failure (non-fatal)
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add logTTSFailure method to write failure logs`

---

### Task 3: Call `logTTSFailure()` in permanent failure path

**Objective:** Integrate the failure logging into the existing retry logic by calling `logTTSFailure()` when a task permanently fails (after 11 retries).

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Call `logTTSFailure()` in `handleTaskFailure` method)
- Test: `src/services/TTSWorkerPool.test.ts` (Purpose: Verify logging is called on permanent failure)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `handleTaskFailure` method (around line 320) to understand the retry logic and permanent failure path.
2. **Write Failing Test:** In `src/services/TTSWorkerPool.test.ts`, write a test that:
   - Spies on the private `logTTSFailure` method using `vi.spyOn(pool, 'logTTSFailure')` (with `@ts-expect-error` for private access)
   - Simulates a task failing after 11 retries
   - Verifies `logTTSFailure` was called with the correct task and error
   Run the test to ensure it fails (the call isn't made yet).
3. **Implement Minimal Code:** In `handleTaskFailure` method, locate the permanent failure block (where `attempt > 11`) and add `await this.logTTSFailure(task, error);` before recording the task failure.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: call logTTSFailure on permanent task failure`

---

### Task 4: Pass `directoryHandle` from `ConversionOrchestrator`

**Objective:** Wire the `directoryHandle` through from `ConversionOrchestrator.runTTSStage()` to `createWorkerPool()` so failure logging has access to the file system.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: Pass `directoryHandle` to `createWorkerPool` in `runTTSStage` function)
- Test: No new test needed — covered by existing integration tests in `src/services/TTSWorkerPool.retry.integration.test.ts`

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `runTTSStage` function (around line 794) to locate where `createWorkerPool` is called.
2. **Implement Minimal Code:** In `runTTSStage`, find the `createWorkerPool()` call and add `directoryHandle` to the options object being passed. The `directoryHandle` should already be available in the scope of `runTTSStage` (it's part of the conversion context).
3. **Verify:** Run the existing retry integration tests (`npm run test:real` is NOT needed — standard unit tests cover this). The `TTSWorkerPool.retry.integration.test.ts` already tests retry behavior and should continue to pass.
4. **Commit:** Commit with message: `feat: pass directoryHandle to TTSWorkerPool in runTTSStage`

---

## Summary

This plan implements TTS failure logging in 4 sequential tasks:

1. **Task 1:** Extend `WorkerPoolOptions` interface to accept `directoryHandle`
2. **Task 2:** Implement `logTTSFailure()` method with file writing logic
3. **Task 3:** Call `logTTSFailure()` in the permanent failure path
4. **Task 4:** Wire `directoryHandle` through from `ConversionOrchestrator`

Each task follows TDD red-green methodology: write failing test first, then implement minimal code to pass it. The implementation reuses the existing `logs/` folder and uses sequential file naming to avoid write conflicts.
