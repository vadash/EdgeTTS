# Core Services

The core conversion pipeline (Text -> LLM -> TTS -> Audio). Managed by stateless `ConversionOrchestrator.ts`.

## Architecture

- **Split**: `TextBlockSplitter` parses text by natural scene breaks.
- **LLM**: `LLMVoiceService` orchestrates Extract -> Merge -> Assign API passes.
- **TTS**: `TTSWorkerPool` manages Edge TTS WebSockets via `ReusableEdgeTTSService` (persistent connections). Scales concurrency via `LadderController`. Streams to disk. Chunks that fail 5 retries are marked permanently failed (no offline fallback).
- **Voice Allocation**: `VoiceAllocator` provides tiered voice allocation with cycling pool support. `VoicePoolBuilder` constructs initial voice pools. Allocation is deterministic by design: the pool is priority-ordered and picks are always first-available. A "reroll below row N" therefore returns the identical assignment unless the pool order is explicitly shuffled — reserving the rows above strips exactly the voices they consumed off the front of the pool, so the rows below land on the same voices again. Any shuffle must stay within priority tiers (native before Multilingual), or a book gets a Multilingual voice while a native one sits unused.
- **Merge**: `AudioMerger` reads from `ChunkStore`, uses `FFmpegService` for EQ/compression/Opus encoding. Merge groups run on a parallel pool of N FFmpeg instances (see gotchas leaf).

## Detailed Gotchas

- Modifying `TTSWorkerPool` lifecycle/retries → read `agent_docs/services/tts-worker-pool_gotchas.md`
- Touching FFmpeg, ChunkStore, or crash recovery → read `agent_docs/services/ffmpeg-and-storage_gotchas.md`
- Modifying `TextBlockSplitter` or sentence splitting → read `agent_docs/services/text-block-splitter_gotchas.md`
