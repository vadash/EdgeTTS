# Core Services

The core conversion pipeline (Text -> LLM -> TTS -> Audio). Managed by stateless `ConversionOrchestrator.ts`.

## Architecture

- **Split**: `TextBlockSplitter` parses text by natural scene breaks.
- **LLM**: `LLMVoiceService` orchestrates Extract -> Merge -> Assign API passes.
- **TTS**: `TTSWorkerPool` manages Edge TTS WebSockets. Scales concurrency via `LadderController`. Streams to disk.
- **Merge**: `AudioMerger` reads from `ChunkStore`, uses `FFmpegService` for EQ/compression/Opus encoding.

## Gotchas

- **Memory Management**: Do NOT hold audio in RAM. Stream directly to `ChunkStore` (`_temp_work`).
- **FFmpeg Leaks**: `FFmpegService` proactively terminates and reloads itself after 10 operations.
- **FFmpeg Loading**: `FFmpegService.reload` tries 3 tiers: In-memory Blob URL -> IndexedDB -> Network fetch.
- **Session Resume**: `ResumeCheck.ts` reads `_temp_work/pipeline_state.json` to seamlessly recover crashed conversions.
- **Async Resilience**: Always throw `RetriableError` in API clients so `withRetry` logic catches it.

## TTS Worker Pool Constraints

- **Destroy on Failure**: Call `await this.connectionPool.destroy(service)` in catch blocks. Never `release()` a failed socket.
- **Clear Timers**: Call `clearTimeout` on all `retryTimers` during `cleanup()`/`clear()` to stop ghost tasks.
- **Clear State**: Call `retryCount.delete(task.partIndex)` on success OR permanent failure to prevent memory leaks.
- **Cancellation Guard**: Verify `this.totalTasks > 0` in `executeTask` before updating state.
- **Queue Pausing**: `p-queue` pauses on `offline` events and resumes on `online` events to preserve retry budget.
- **Failure Logs**: Permanent task failures (5 retries) write gracefully to `logs/tts_fail*.json`.
