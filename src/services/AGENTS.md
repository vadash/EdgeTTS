# Core Services

The core conversion pipeline (Text -> LLM -> TTS -> Audio). Managed by stateless `ConversionOrchestrator.ts`.

## Architecture

- **Split**: `TextBlockSplitter` parses text by natural scene breaks.
- **LLM**: `LLMVoiceService` orchestrates Extract -> Merge -> Assign API passes.
- **TTS**: `TTSWorkerPool` manages Edge TTS WebSockets via `ReusableEdgeTTSService` (persistent connections). Scales concurrency via `LadderController`. Streams to disk. Chunks that fail 5 retries are marked permanently failed (no offline fallback).
- **Voice Allocation**: `VoiceAllocator` provides tiered voice allocation with cycling pool support. `VoicePoolBuilder` constructs initial voice pools.
- **Merge**: `AudioMerger` reads from `ChunkStore`, uses `FFmpegService` for EQ/compression/Opus encoding. Merge groups run on a parallel pool of N FFmpeg instances (see gotchas leaf).

## Detailed Gotchas

- Modifying `TTSWorkerPool` lifecycle/retries → read `agent_docs/services/tts-worker-pool_gotchas.md`
- Touching FFmpeg, ChunkStore, or crash recovery → read `agent_docs/services/ffmpeg-and-storage_gotchas.md`
- Modifying `TextBlockSplitter` or sentence splitting → read `agent_docs/services/text-block-splitter_gotchas.md`
