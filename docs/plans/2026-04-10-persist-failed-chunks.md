# Persist Failed Chunks + Progress UI Implementation Plan

**Goal:** Skip permanently failed chunks on resume; show three-color done/failed/remaining progress UI.
**Architecture:** Two independent subsystems — (1) persist failed chunk indices to `_temp_work/failed_chunks.json` so they are skipped on resume, (2) extend the `Progress` type and `ProgressBar` component with a `failed` field and three-color display. The orchestrator touches both.
**Tech Stack:** TypeScript, Preact, Vitest

---

### File Structure Overview

- Modify: `src/stores/ConversionStore.ts` — add `failed` to `Progress` type, update `updateProgress` signature, adjust ETA and `progressPercent`
- Modify: `src/stores/ConversionStore.test.ts` — add/update tests for `failed` field
- Modify: `src/components/status/ProgressBar.tsx` — add `failed` prop, three-color rendering
- Create: `src/components/status/ProgressBar.test.tsx` — unit tests for ProgressBar
- Modify: `src/components/status/StatusPanel.tsx` — pass `failed` prop to ProgressBar
- Modify: `src/stores/index.ts` — export `updateProgress` (already exported, no change needed)
- Modify: `src/test/utils.tsx` — pass `failed` in test helper `updateProgress` call
- Modify: `src/services/ConversionOrchestrator.ts` — read/write `failed_chunks.json`, pass `failed` count in progress reports

---

### Task 1: Add `failed` field to `Progress` type and update store functions

**Files:**
- Modify: `src/stores/ConversionStore.ts`
- Test: `src/stores/ConversionStore.test.ts`

**Common Pitfalls:**
- `updateProgress` is also called from `src/test/utils.tsx` — that file will need updating in Task 3
- `incrementProgress` and `setTotal` must preserve the `failed` field when patching progress
- `progressPercent` must remain based on `current / total` (failed chunks are part of total)
- `estimatedTimeRemaining` should exclude failed chunks from its remaining-work estimate

- [ ] Step 1: Write the failing tests

Add these tests inside `src/stores/ConversionStore.test.ts`:

In the `"progress management"` describe block, add:

```typescript
it('updates progress with failed count', () => {
  updateProgress(5, 10, 2);
  expect(conversion.value.progress).toEqual({ current: 5, total: 10, failed: 2 });
});

it('defaults failed to 0 when not provided', () => {
  updateProgress(5, 10);
  expect(conversion.value.progress).toEqual({ current: 5, total: 10, failed: 0 });
});

it('increments progress preserving failed count', () => {
  updateProgress(5, 10, 2);
  incrementProgress();
  expect(conversion.value.progress).toEqual({ current: 6, total: 10, failed: 2 });
});

it('sets total preserving failed count', () => {
  updateProgress(3, 5, 2);
  setTotal(20);
  expect(conversion.value.progress).toEqual({ current: 3, total: 20, failed: 2 });
});
```

Update the existing `"updates progress"` test:

```typescript
it('updates progress', () => {
  updateProgress(5, 10);
  expect(conversion.value.progress).toEqual({ current: 5, total: 10, failed: 0 });
});
```

Update the existing `"increments progress"` test:

```typescript
it('increments progress', () => {
  updateProgress(5, 10);
  incrementProgress();
  expect(conversion.value.progress).toEqual({ current: 6, total: 10, failed: 0 });
});
```

Update the existing `"sets total count"` test:

```typescript
it('sets total count', () => {
  updateProgress(3, 5);
  setTotal(20);
  expect(conversion.value.progress).toEqual({ current: 3, total: 20, failed: 0 });
});
```

Update the existing `"resets all state to initial values"` test:

```typescript
it('resets all state to initial values', () => {
  setStatus('converting');
  updateProgress(5, 10, 2);
  setError('Error');
  startConversion();

  resetConversionStore();

  expect(conversion.value.status).toBe('idle');
  expect(conversion.value.progress).toEqual({ current: 0, total: 0, failed: 0 });
  expect(conversion.value.startTime).toBeNull();
  expect(conversion.value.phaseStartTime).toBeNull();
  expect(conversion.value.error).toBeNull();
});
```

Update the `"starts with zero progress"` test:

```typescript
it('starts with zero progress', () => {
  expect(conversion.value.progress).toEqual({ current: 0, total: 0, failed: 0 });
});
```

Update the `"resets progress to zero"` test:

```typescript
it('resets progress to zero', () => {
  updateProgress(5, 10, 2);
  startConversion();
  expect(conversion.value.progress).toEqual({ current: 0, total: 0, failed: 0 });
});
```

In the `"estimated time remaining"` describe block, update the existing tests that call `updateProgress` to pass the `failed` param (the two-arg calls still work since `failed` defaults to `0`). No changes needed to the ETA test logic yet — we'll add the ETA-excludes-failed test after implementing the store.

Add a new test after the ETA tests:

```typescript
it('excludes failed chunks from remaining work estimate', () => {
  const startTime = 1000000;
  vi.spyOn(Date, 'now').mockReturnValue(startTime);
  startConversion();
  setStatus('converting');
  updateProgress(0, 100, 0);

  // Advance time by 10 seconds, complete 10 items
  vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
  updateProgress(10, 100, 5);

  // 10 successful items in 10 seconds = 1s/item
  // Remaining successful items: 100 - 10 - 5 = 85
  // ETA: 85 * 1s = 85s = 00:01:25
  expect(estimatedTimeRemaining.value).toBe('00:01:25');

  vi.restoreAllMocks();
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/ConversionStore.test.ts`
Expected: FAIL — `failed` property missing from `Progress` type, `updateProgress` doesn't accept 3 args

- [ ] Step 3: Write minimal implementation

In `src/stores/ConversionStore.ts`:

**a) Update `Progress` type (line 20-23):**

```typescript
interface Progress {
  current: number;
  total: number;
  failed: number;
}
```

**b) Update `defaultState` (line 52-62) — change progress default:**

```typescript
progress: { current: 0, total: 0, failed: 0 },
```

**c) Update `updateProgress` (line 188-190):**

```typescript
function updateProgress(current: number, total: number, failed: number = 0): void {
  patchState({ progress: { current, total, failed } });
}
```

**d) Update `incrementProgress` (line 192-195):**

```typescript
function incrementProgress(): void {
  const { current, total, failed } = conversion.value.progress;
  patchState({ progress: { current: current + 1, total, failed } });
}
```

**e) Update `setTotal` (line 197-199):**

```typescript
function setTotal(total: number): void {
  const { current, failed } = conversion.value.progress;
  patchState({ progress: { current, total, failed } });
}
```

**f) Update `progressPercent` (line 92-96) — no change needed, already uses `current / total`:**

Already correct as-is.

**g) Update `estimatedTimeRemaining` (line 112-132):**

Replace the body after the guard clauses with:

```typescript
const estimatedTimeRemaining = computed(() => {
  const { current, total, failed } = conversion.value.progress;
  const status = conversion.value.status;

  if (
    status !== 'llm-extract' &&
    status !== 'llm-assign' &&
    status !== 'converting' &&
    status !== 'merging'
  ) {
    return null;
  }

  const start = conversion.value.phaseStartTime;
  if (!start || total === 0 || current === 0) return null;

  const elapsed = Date.now() - start;
  const successfulCurrent = current - failed;
  if (successfulCurrent <= 0) return null;
  const rate = elapsed / successfulCurrent;
  const remainingItems = total - current;
  return formatDuration(remainingItems * rate);
});
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/ConversionStore.test.ts`
Expected: PASS (all tests green)

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: add failed field to Progress type and update store functions"
```

---

### Task 2: Update ProgressBar component with three-color display

**Files:**
- Modify: `src/components/status/ProgressBar.tsx`
- Create: `src/components/status/ProgressBar.test.tsx`

**Common Pitfalls:**
- The `failed` prop must be optional with default `0` to avoid breaking existing callers
- `remaining` is calculated as `total - current - failed` (not `total - current`)
- The percentage is still `current / total * 100`

- [ ] Step 1: Write the failing tests

Create `src/components/status/ProgressBar.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders null when total is 0', () => {
    const result = render(<ProgressBar current={0} total={0} />);
    expect(result).toBe('');
  });

  it('renders current / total with percentage', () => {
    const html = render(<ProgressBar current={50} total={100} />);
    expect(html).toContain('50%');
    expect(html).toContain('50 / 100');
  });

  it('renders done count in green', () => {
    const html = render(<ProgressBar current={50} total={100} failed={0} />);
    expect(html).toContain('text-green-400');
    expect(html).toContain('50');
  });

  it('renders failed count in red when failed > 0', () => {
    const html = render(<ProgressBar current={60} total={100} failed={10} />);
    expect(html).toContain('text-red-400');
    expect(html).toContain('10');
  });

  it('does not render failed section when failed is 0', () => {
    const html = render(<ProgressBar current={50} total={100} failed={0} />);
    expect(html).not.toContain('text-red-400');
  });

  it('renders remaining count in gray', () => {
    const html = render(<ProgressBar current={60} total={100} failed={10} />);
    expect(html).toContain('text-gray-400');
    // remaining = 100 - 60 - 10 = 30
    expect(html).toContain('30');
  });

  it('renders ETA when provided', () => {
    const html = render(<ProgressBar current={50} total={100} eta="00:05:00" />);
    expect(html).toContain('00:05:00');
  });

  it('does not render ETA when absent', () => {
    const html = render(<ProgressBar current={50} total={100} />);
    expect(html).not.toContain('ETA');
  });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run src/components/status/ProgressBar.test.tsx`
Expected: FAIL — tests checking for `text-green-400`, `text-red-400`, `text-gray-400` won't match current rendering

- [ ] Step 3: Write minimal implementation

Replace the entire `src/components/status/ProgressBar.tsx`:

```tsx
interface ProgressBarProps {
  current: number;
  total: number;
  failed?: number;
  eta?: string;
}

function ProgressBar({ current, total, failed = 0, eta }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  if (total === 0) return null;

  const remaining = total - current - failed;

  return (
    <div className="space-y-2">
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-green-400">
            {'\u2713'} {current}
          </span>
          {failed > 0 && (
            <span className="text-red-400">
              {'\u2717'} {failed}
            </span>
          )}
          {remaining > 0 && (
            <span className="text-gray-400">
              {'\u25CC'} {remaining}
            </span>
          )}
          <span>({percentage}%)</span>
        </div>
        {eta && <span>ETA: {eta}</span>}
      </div>
    </div>
  );
}

export { ProgressBar };
export type { ProgressBarProps };
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run src/components/status/ProgressBar.test.tsx`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: three-color progress bar with done/failed/remaining display"
```

---

### Task 3: Update StatusPanel and test utility to pass `failed` prop

**Files:**
- Modify: `src/components/status/StatusPanel.tsx`
- Modify: `src/test/utils.tsx`

- [ ] Step 1: Update StatusPanel to pass `failed` prop

In `src/components/status/StatusPanel.tsx`, change line:

```tsx
const { current, total } = conversion.progress.value;
```

to:

```tsx
const { current, total, failed } = conversion.progress.value;
```

And change the ProgressBar invocation:

```tsx
<ProgressBar current={current} total={total} eta={eta} />
```

to:

```tsx
<ProgressBar current={current} total={total} failed={failed} eta={eta} />
```

- [ ] Step 2: Update test utility to pass `failed`

In `src/test/utils.tsx`, change:

```tsx
updateProgress(c.progress.current, c.progress.total);
```

to:

```tsx
updateProgress(c.progress.current, c.progress.total, c.progress.failed ?? 0);
```

- [ ] Step 3: Run tests to verify nothing is broken

Run: `npx vitest run`
Expected: PASS (all tests green)

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat: wire failed count through StatusPanel and test utils"
```

---

### Task 4: Persist failed chunks to `failed_chunks.json` in runTTSStage

**Files:**
- Modify: `src/services/ConversionOrchestrator.ts`

**Common Pitfalls:**
- `failed_chunks.json` lives inside `_temp_work/` directory (using the same `tempDirHandle`)
- Read/write must be non-fatal — corrupted/missing file is treated as empty set, write failure is logged and skipped
- On pre-scan, failed chunk indices must be added to `audioMap` (as if they were already handled) so they are skipped during TTS and flow through to merge as silence
- The orchestrator already has a local `failedTasks` set that collects failures from `onTaskError` — this is separate from the persisted set

- [ ] Step 1: Write the failing test

There is no existing unit test file for `ConversionOrchestrator`. The functions are large and depend on `FileSystemDirectoryHandle` which is only available in browser. Testing will be done via the integration test path. However, we can verify the logic by checking that the build compiles and typechecks.

Instead of a unit test, we'll verify with typecheck and the existing integration tests.

- [ ] Step 2: Implement failed_chunks.json read (pre-scan) in `runTTSStage`

In `src/services/ConversionOrchestrator.ts`, inside the `runTTSStage` function, after the pre-scan loop (after the block that reads existing `.bin` files into `audioMap`), add the failed-chunks loading logic:

After the `if (audioMap.size > 0)` report block and before `const remainingChunks = ...`, insert:

```typescript
    // Load previously failed chunks
    try {
      const failedHandle = await tempDirHandle.getFileHandle('failed_chunks.json');
      const failedFile = await failedHandle.getFile();
      const failedText = await failedFile.text();
      const failedIndices: number[] = JSON.parse(failedText);
      let skippedCount = 0;
      for (const idx of failedIndices) {
        if (!audioMap.has(idx)) {
          audioMap.set(idx, '');
          skippedCount++;
        }
      }
      if (skippedCount > 0) {
        report(
          'tts-conversion',
          audioMap.size,
          chunks.length,
          `Skipping ${skippedCount} previously failed chunk(s)`,
        );
      }
    } catch {
      // No failed_chunks.json or corrupted — treat as empty set
    }
```

- [ ] Step 3: Implement failed_chunks.json write (post-pool) in `runTTSStage`

After the `signal.removeEventListener('abort', abortHandler);` and before the `tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work');` line (i.e., after the worker pool Promise resolves), insert:

```typescript
    // Persist failed chunks
    if (failedTasks.size > 0) {
      try {
        const workDir = tempDirHandle ?? await directoryHandle.getDirectoryHandle('_temp_work');
        // Load existing failed set and union with current failures
        let existingFailed: Set<number> = new Set();
        try {
          const existingHandle = await workDir.getFileHandle('failed_chunks.json');
          const existingFile = await existingHandle.getFile();
          const existingText = await existingFile.text();
          const existingIndices: number[] = JSON.parse(existingText);
          existingFailed = new Set(existingIndices);
        } catch {
          // No existing file — start fresh
        }
        for (const idx of failedTasks) {
          existingFailed.add(idx);
        }
        const failedJson = JSON.stringify([...existingFailed].sort((a, b) => a - b));
        const failedFileHandle = await workDir.getFileHandle('failed_chunks.json', { create: true });
        const writable = await failedFileHandle.createWritable();
        await writable.write(failedJson);
        await writable.close();
        report(
          'tts-conversion',
          audioMap.size,
          chunks.length,
          `Persisted ${existingFailed.size} total failed chunk(s) to failed_chunks.json`,
        );
      } catch (err) {
        logger.warn(`Failed to persist failed_chunks.json: ${(err as Error).message}`);
      }
    }
```

- [ ] Step 4: Pass `failed` count in progress reports

In the `onTaskError` callback inside `runTTSStage`, change the report call to include the failed count. The `report` function signature is `(stage, current, total, message)` — it does not accept `failed`. We need to pass it differently.

Since `report` just calls `logger.info` and `updateStatus`, and the actual `updateProgress` is called separately through the store, we need a different approach. Looking at how `report` is used: it's defined in `runConversion` as:

```typescript
const report = (stage: string, _current: number, _total: number, message: string) => {
    logger.info(message);
    updateStatus(stage, stores);
};
```

The `_current` and `_total` params are currently unused (prefixed with `_`). The progress update happens through the store. We need to also call `updateProgress` with the `failed` count from within `runTTSStage`.

In `runTTSStage`, the `_stores` parameter is currently unused. Change the signature to use `stores`:

```typescript
async function runTTSStage(
  input: OrchestratorInput,
  assignments: SpeakerAssignment[],
  fileNames: Array<[string, number]>,
  signal: AbortSignal,
  report: (stage: string, current: number, total: number, message: string) => void,
  services: ConversionOrchestratorServices,
  stores: Stores,
): Promise<void> {
```

Then, inside `onTaskComplete`, update the report calls to also call `updateProgress`:

In the `onTaskComplete` callback, after the existing report call, add:

```typescript
import { updateProgress } from '@/stores/ConversionStore';
```

Add this import at the top of the file (alongside existing imports).

Then in `onTaskComplete`, change the throttled report to also call `updateProgress`:

```typescript
onTaskComplete: (partIndex) => {
  audioMap.set(partIndex, `chunk_${String(partIndex).padStart(6, '0')}.bin`);
  const completed = audioMap.size;
  const percentageInterval = Math.max(1, Math.floor(chunks.length * 0.01));
  const minInterval = 50;
  const maxInterval = 500;
  const step = 50;
  const clampedInterval = Math.max(minInterval, Math.min(percentageInterval, maxInterval));
  const reportInterval = Math.round(clampedInterval / step) * step;
  const finalInterval = Math.max(minInterval, Math.min(reportInterval, maxInterval));

  if (completed % finalInterval === 0 || completed === chunks.length) {
    report(
      'tts-conversion',
      completed,
      chunks.length,
      `Written ${completed}/${chunks.length} files`,
    );
    updateProgress(completed, chunks.length, failedTasks.size);
  }
},
```

In `onTaskError`, after adding to `failedTasks`:

```typescript
onTaskError: (partIndex, error) => {
  failedTasks.add(partIndex);
  report(
    'tts-conversion',
    audioMap.size,
    chunks.length,
    `Part ${partIndex + 1} failed: ${getErrorMessage(error)}`,
  );
  updateProgress(audioMap.size, chunks.length, failedTasks.size);
},
```

Also add an initial progress report with `failed: 0` at the start (the existing `report('tts-conversion', 0, chunks.length, ...)` call). Add after it:

```typescript
report('tts-conversion', 0, chunks.length, `Converting ${chunks.length} chunks to audio...`);
updateProgress(0, chunks.length, 0);
```

And in the resume report block:

```typescript
if (audioMap.size > 0) {
  report(
    'tts-conversion',
    audioMap.size,
    chunks.length,
    `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`,
  );
  updateProgress(audioMap.size, chunks.length, 0);
}
```

- [ ] Step 5: Run typecheck to verify compilation

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] Step 6: Run full test suite

Run: `npx vitest run`
Expected: PASS

- [ ] Step 7: Commit

```bash
git add -A && git commit -m "feat: persist failed chunks to failed_chunks.json and report failed count in progress"
```

---

### Task 5: Run linter and final typecheck

**Files:**
- None (verification only)

- [ ] Step 1: Run linter

Run: `npm run lint`
Expected: No errors

- [ ] Step 2: Run typecheck

Run: `npm run typecheck`
Expected: No errors

- [ ] Step 3: Run full test suite one final time

Run: `npm test`
Expected: All tests pass
