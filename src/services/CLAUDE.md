# Core Services & Conversion Pipeline

The engine that drives the conversion from Text -> LLM -> TTS -> Audio File. Managed by `ConversionOrchestrator.ts` which runs a strict sequential pipeline.

## Architecture

1. **Split**: `TextBlockSplitter` parses text into LLM-friendly blocks. Prefers natural scene breaks (dividers, chapter headers, long narration).
2. **LLM Passes**: Extract Characters -> Merge/Dedupe -> Assign Speakers (`LLMVoiceService.ts`).
3. **TTS**: `TTSWorkerPool` manages WebSocket connections to Edge TTS using a `LadderController` to scale concurrency based on rate limits.
4. **Merge**: `AudioMerger` streams downloaded chunks through `FFmpegService` to concatenate, apply filters (EQ, compression), and encode to Opus/MP3.

## Key Files

- `ConversionOrchestrator.ts` - Main entry point; completely stateless orchestrator function.
- `FFmpegService.ts` - FFmpeg WASM wrapper. Bundled **locally** (not loaded from CDN). Uses `toBlobURL()` to create blob URLs.
- `TTSWorkerPool.ts` - Handles queued TTS requests with dynamic scaling.
- `llm/LLMVoiceService.ts` - Orchestrates the Extract -> Merge -> Assign API calls.
- `llm/LLMApiClient.ts` - Low-level API caller with custom fetch for browser header overrides.

## Gotchas

- **Memory Management**: Do NOT load entire audio files into memory. `TTSWorkerPool` writes chunks to a local `_temp_work` folder immediately. `AudioMerger` reads them sequentially.
- **File System**: The app writes directly to the user's hard drive to prevent OOM errors. All file operations MUST use `withPermissionRetry` to handle browser security drops.
- **WASM Memory Leaks**: FFmpeg WASM memory leaks are a risk. `FFmpegService` proactively terminates and reloads itself after a set number of operations (`MAX_OPERATIONS_BEFORE_REFRESH`).
- **Async Resilience**: Network and WebSocket calls must use the internal `withRetry` utility (which wraps `p-retry`) to survive sleep modes and rate limits. ALWAYS throw `RetriableError` in `LLMApiClient` on failure.
- **State**: Services should remain as stateless as possible. Pass data via arguments or update the UI via the imported `Stores`.
