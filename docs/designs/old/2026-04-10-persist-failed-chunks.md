# Persist Failed Chunks + Progress UI

## Problem

When resuming a conversion, the app treats all chunks without a `.bin` file as "not yet attempted." This includes chunks that permanently failed on the previous run (after exhausting all 11 retries each). The app wastes ~1 hour re-retrying these chunks before reaching the Opus merge stage.

Additionally, the progress bar only shows completed/total with no visibility into how many chunks failed.

## Design

### Part 1: Persist Failed Chunks

**Goal:** On resume, skip chunks that permanently failed in a previous run. They will be replaced with silence in the final audiobook (existing behavior of `AudioMerger.mergeAudioGroupAsync`).

**Format:** `_temp_work/failed_chunks.json` — a plain JSON array of chunk indices:
```json
[42, 187, 1203]
```

#### Write (ConversionOrchestrator.runTTSStage)

After the TTS worker pool finishes and we have `pool.getFailedTasks()`:

1. Load existing `failed_chunks.json` if present (handles multiple runs accumulating failures)
2. Union the existing set with current `getFailedTasks()`
3. Write the combined set back to `_temp_work/failed_chunks.json`
4. Log: `"Persisted X total failed chunk(s) to failed_chunks.json"`

#### Read (ConversionOrchestrator.runTTSStage, during pre-scan)

After scanning for existing `.bin` files:

1. Try to read `_temp_work/failed_chunks.json`
2. Parse into a `Set<number>`
3. Add each index to `audioMap` (so the chunk is treated as "already handled")
4. Log: `"Skipping X previously failed chunk(s)"`

These chunks then flow through to `mergeAndSave` as missing entries — which already replaces them with silence.

#### Cleanup

`failed_chunks.json` is deleted when a fresh (non-resume) conversion starts. This happens naturally since `_temp_work` is recreated for new conversions.

#### Error handling

- File can't be read (corrupted, missing) — treat as empty set, no blocking
- File can't be written — log warning, continue (non-fatal)

#### Files changed

- `src/services/ConversionOrchestrator.ts` only — read/write `failed_chunks.json` within `runTTSStage`

#### No changes to

- `TTSWorkerPool.ts` — untouched
- `AudioMerger.ts` — untouched (already handles missing chunks with silence)
- `ResumeCheck.ts` — untouched
- `PipelineState` type — untouched

---

### Part 2: Extended Progress UI

**Goal:** Show done/failed/remaining counts in distinct colors in the progress bar.

#### Current state

- `Progress` type: `{ current: number; total: number }`
- `ProgressBar` renders: `{current} / {total} ({percentage}%)` in a single color
- `TTSWorkerPool.getProgress()` already returns `{ failed: this.failedTasks.size, ... }`

#### Changes

**1. Progress type** (`src/stores/ConversionStore.ts`)

Add `failed` field:
```typescript
interface Progress {
  current: number;
  total: number;
  failed: number;
}
```

Default value: `failed: 0`.

**2. Store updates** (`src/stores/ConversionStore.ts`)

- `updateProgress(current, total)` — needs a `failed` parameter: `updateProgress(current: number, total: number, failed: number)`
- `progressPercent` computed — should remain based on `current / total` (failed chunks are part of total)
- `estimatedTimeRemaining` — exclude failed chunks from remaining work estimate; use `current / (total - failed)` or similar

**3. ProgressBar rendering** (`src/components/status/ProgressBar.tsx`)

Add `failed` prop. Render three numbers:

```
✓ 1234  ✗ 42  ◌ 324  (57%)          ETA: 00:12:34
```

- Done (green `text-green-400`): successfully completed chunks
- Failed (red `text-red-400`): permanently failed chunks
- Remaining (gray `text-gray-400`): not yet processed

The visual progress bar fill could optionally show a small red segment for failed chunks, but this is a minor visual refinement — the text display is the primary change.

**4. Orchestrator reporting** (`src/services/ConversionOrchestrator.ts`)

Pass the failed count from `pool.getProgress().failed` through to `updateProgress()` in the throttled progress reports and the final report.

#### Files changed

- `src/stores/ConversionStore.ts` — `Progress` type, `updateProgress`, computed signals, default state
- `src/components/status/ProgressBar.tsx` — `ProgressBarProps`, rendering
- `src/services/ConversionOrchestrator.ts` — pass `failed` count in progress updates (alongside Part 1 changes)

#### No changes to

- `TTSWorkerPool.ts` — already exposes `failed` in `getProgress()`
- `AudioMerger.ts` — untouched
- `StatusPanel.tsx` — passes through props from store, no structural changes needed

---

## Summary of all changes

| File | Changes |
|------|---------|
| `ConversionOrchestrator.ts` | Read/write `failed_chunks.json` in `runTTSStage`; pass `failed` count in progress updates |
| `ConversionStore.ts` | Add `failed` to `Progress` type; update `updateProgress` signature; adjust ETA calculation |
| `ProgressBar.tsx` | Add `failed` prop; render three-color done/failed/remaining display |
