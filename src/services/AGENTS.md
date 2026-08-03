# Core Services

The conversion pipeline, driven by a stateless orchestrator.

## Stages

- Split: parse text into blocks at natural scene breaks.
- LLM: run extract, then merge, then assign passes.
- TTS: a worker pool drives persistent Edge TTS sockets and streams audio to disk.
- Merge: read stored chunks and encode the final audio with FFmpeg.

## Rules

- TTS concurrency scales through the ladder controller. Do not set it directly.
- A chunk that exhausts its retries is permanently failed. There is no offline fallback.
- Voice allocation is deterministic. The pool is priority-ordered and picks the first free voice.
- Rerolling a subset returns the same voices unless the pool order is shuffled explicitly.
- A shuffle must stay inside its priority tier, so a native voice is never passed over for a multilingual one.

## Detailed Gotchas

- Changing pool lifecycle, retries, or cancellation → read `../../agent_docs/services/tts-worker-pool_gotchas.md`.
- Changing FFmpeg, chunk storage, or crash recovery → read `../../agent_docs/services/ffmpeg-and-storage_gotchas.md`.
- Changing sentence splitting or block sizes → read `../../agent_docs/services/text-block-splitter_gotchas.md`.
