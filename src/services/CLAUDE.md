# Core Services & Conversion Pipeline

**WHAT**: The engine that drives the conversion from Text -> LLM -> TTS -> Audio File.
**HOW**: Managed by `ConversionOrchestrator.ts` which runs a strict sequential pipeline.

## Pipeline Architecture
1. **Split**: `TextBlockSplitter` parses text into LLM-friendly blocks.
2. **LLM Passes**: Extract Characters -> Merge/Dedupe -> Assign Speakers.
3. **TTS**: `TTSWorkerPool` manages WebSocket connections to Edge TTS using a `LadderController` to scale concurrency based on rate limits.
4. **Merge**: `AudioMerger` streams downloaded chunks through `FFmpegService` (WASM) to concatenate, apply filters (EQ, compression), and encode to Opus/MP3.

## Gotchas & Rules
- **Memory Management**: Do NOT load entire audio files into memory. `TTSWorkerPool` writes chunks to a local `_temp_work` folder immediately. `AudioMerger` reads them sequentially.
- **FFmpeg Lifecycle**: WASM memory leaks are a risk. `FFmpegService` proactively terminates and reloads itself after a set number of operations.
- **State**: Services should remain as stateless as possible. Pass data via arguments or update the UI via the imported `Stores`.
