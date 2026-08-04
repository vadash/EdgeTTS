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
- Voice allocation is gender-routed: a female character gets a female voice, male a male, unknown borrows whichever pool is less used.
- Top characters (by line count) get distinct voices from the first 80% of each gender pool; the rest round-robin the remaining 20% (repeats allowed).
- Rerolling a subset returns the same voices unless the pool order is shuffled explicitly.
- A shuffle must stay inside its priority tier, so a native voice is never passed over for a multilingual one.

## Detailed Gotchas

- Changing pool lifecycle, retries, or cancellation → read `../../agent_docs/services/tts-worker-pool_gotchas.md`.
- Changing FFmpeg, chunk storage, or crash recovery → read `../../agent_docs/services/ffmpeg-and-storage_gotchas.md`.
- Changing sentence splitting or block sizes → read `../../agent_docs/services/text-block-splitter_gotchas.md`.
- Changing voice allocation, the 80/20 split, or reroll invariance → read `../../agent_docs/services/voice-allocation_gotchas.md`.
