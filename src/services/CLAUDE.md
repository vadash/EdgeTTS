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
- `FFmpegService.ts` - FFmpeg WASM wrapper. Bundled **locally** (not CDN). Proactively reboots to prevent WASM OOM.
- `llm/LLMVoiceService.ts` - Orchestrates Extract -> Merge -> Assign API calls, including the QA and Consensus loops.
- `llm/LLMApiClient.ts` - Low-level API caller with custom fetch for browser header overrides.

## Gotchas

- **Memory Management**: Do NOT load entire audio files into memory. `TTSWorkerPool` streams to `ChunkStore` in `_temp_work`. `AudioMerger` reads sequentially.
- **FFmpeg Leaks**: FFmpeg WASM memory leaks are a risk. `FFmpegService` proactively terminates and reloads itself after `MAX_OPERATIONS_BEFORE_REFRESH` (10 operations).
- **Session Resumption**: `ResumeCheck.ts` reads `_temp_work` and `pipeline_state.json` to seamlessly recover crashed/closed conversions without re-querying the LLM.
- **Async Resilience**: Always throw `RetriableError` in `LLMApiClient` on failure so `withRetry` can retry. Non-retriable errors kill the pipeline.
- **State**: Services should remain as stateless as possible. Pass data via arguments or update the UI via the imported `Stores` bundle.
