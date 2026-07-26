# Core Services

The core conversion pipeline (Text -> LLM -> TTS -> Audio). Managed by stateless `ConversionOrchestrator.ts`.

## Architecture

- **Split**: `TextBlockSplitter` parses text by natural scene breaks.
- **LLM**: `LLMVoiceService` orchestrates Extract -> Merge -> Assign API passes.
- **TTS**: `TTSWorkerPool` manages Edge TTS WebSockets. Scales concurrency via `LadderController`. Streams to disk.
- **Voice Allocation**: `VoiceAllocator` provides tiered voice allocation with cycling pool support. `VoicePoolBuilder` constructs initial voice pools.
- **Fallback**: `KokoroFallbackService` provides offline TTS fallback via Kokoro. `ReusableEdgeTTSService` manages persistent Edge TTS connections.
- **Merge**: `AudioMerger` reads from `ChunkStore`, uses `FFmpegService` for EQ/compression/Opus encoding. Merge groups run on a parallel pool of N FFmpeg instances (see gotchas leaf).

## Detailed Gotchas

- Modifying `TTSWorkerPool` lifecycle/retries → read `agent_docs/services/tts-worker-pool_gotchas.md`
- Touching FFmpeg, ChunkStore, or crash recovery → read `agent_docs/services/ffmpeg-and-storage_gotchas.md`
