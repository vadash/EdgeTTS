# Core Services & Conversion Pipeline

The engine that drives the conversion from Text -> LLM -> TTS -> Audio File. Managed by `ConversionOrchestrator.ts` which runs a strict sequential pipeline.

## Architecture

1. **Split**: `TextBlockSplitter` parses text into LLM-friendly blocks. Prefers natural scene breaks (dividers, chapter headers, long narration).
2. **LLM Passes**: Extract Characters -> Merge/Dedupe -> Assign Speakers (`LLMVoiceService.ts`).
3. **TTS**: `TTSWorkerPool` manages WebSocket connections to Edge TTS using a `LadderController` to scale concurrency based on rate limits. Audio is written directly to disk via `ChunkStore`.
4. **Merge**: `AudioMerger` reads downloaded chunks from `ChunkStore`, passes them through `FFmpegService` to concatenate, apply filters (EQ, compression), and encode to Opus/MP3.

## Key Files

- `ConversionOrchestrator.ts` - Main entry point; completely stateless orchestrator function.
- `ChunkStore.ts` - Handles indexed writes/reads to `chunks_data.bin` on disk. Prevents memory limits on massive books.
- `LadderController.ts` - Scales TTS concurrent workers up/down dynamically based on success/failure rates.
- `FFmpegService.ts` - FFmpeg WASM wrapper. Bundled **locally** (not CDN). Proactively reboots to prevent WASM OOM. Includes `FFmpegBlobCache` namespace for IndexedDB persistence of WASM blobs (offline resilience).
- `llm/LLMVoiceService.ts` - Orchestrates Extract -> Merge -> Assign API calls, including the QA and Consensus loops.
- `llm/LLMApiClient.ts` - Low-level API caller with custom fetch for browser header overrides.

## Gotchas

- **Memory Management**: Do NOT load entire audio files into memory. `TTSWorkerPool` streams to `ChunkStore` in `_temp_work`. `AudioMerger` reads sequentially.
- **FFmpeg Leaks**: FFmpeg WASM memory leaks are a risk. `FFmpegService` proactively terminates and reloads itself after `MAX_OPERATIONS_BEFORE_REFRESH` (10 operations).
- **FFmpeg Loading Cascade**: FFmpegService.reload tries 3 tiers: (1) in-memory blob URLs, (2) IndexedDB persistent blobs, (3) network fetch from local bundle. Tier 2 survives offline and server version changes.
- **Session Resumption**: `ResumeCheck.ts` reads `_temp_work` and `pipeline_state.json` to seamlessly recover crashed/closed conversions without re-querying the LLM.
- **Async Resilience**: Always throw `RetriableError` in `LLMApiClient` on failure so `withRetry` can retry. Non-retriable errors kill the pipeline.
- **State**: Services should remain as stateless as possible. Pass data via arguments or update the UI via the imported `Stores` bundle.

## TTS Worker Pool Retry Behavior

### Re-enqueue Approach (vs. Inline withRetry)

The TTSWorkerPool uses **immediate re-enqueuing** of failed tasks instead of inline `withRetry` exponential backoff. This prevents worker starvation during network issues.

**How it works:**
1. Task fails → Connection destroyed (not released)
2. Retry delay calculated (10s → 20s → 40s ... → 600s max)
3. Task scheduled via `setTimeout` to re-enqueue
4. Worker slot freed immediately to process healthy chunks
5. On timeout, task re-added to queue with fresh connection

**Key difference from old `withRetry`:**
- **Old:** Worker sleeps while holding connection slot (blocks other tasks)
- **New:** Worker freed immediately, task wakes later in background

### Critical Cleanup Requirements

When modifying TTSWorkerPool or integrating with it:

1. **Always destroy on failure** — `await this.connectionPool.destroy(service)` in catch blocks (never `release()`). Failed WebSocket connections are tainted.
2. **Always clear timers** — Both `cleanup()` and `clear()` must clear `retryTimers` to prevent "ghost" tasks waking after cancellation.
3. **Always clear retry state** — Call `retryCount.delete(task.partIndex)` on BOTH success and permanent failure paths to prevent memory leaks in large conversions (100k+ chunks).
4. **Check for cancellation** — In `executeTask`, verify `this.totalTasks === 0` before updating state. If pool was cleared, skip callbacks and just clean up the connection.

### LadderController Integration

- **Success:** Record `0` retries (actual retry count cleared before recording)
- **Permanent failure:** Record `11` retries (max retry limit)
- **Intermediate retries:** Do NOT record — avoids triggering `hasHardFailure` scale-down which looks for `retries >= 10`

### Status Update Pattern

Two status updates during retry cycle:
1. **On failure:** `"Part XXXX: Failed. Retrying in 30s (Attempt 3)"`
2. **On re-execution:** `"Part XXXX: Retrying now..."`

This prevents user perception that the app froze when tasks are in background timers.

### In-Memory State

Retry state (`retryCount`, `retryTimers`) is lost on page refresh — this is acceptable per requirements. Only permanent state (completed audio files, failed task list) persists.
