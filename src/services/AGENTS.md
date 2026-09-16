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

## Decisions

Read the ADR before changing the governed area:

- Pool lifecycle, retries, cancellation → `../../docs/adr/0013-bounded-retry-tts-socket-pool.md`
- FFmpeg, chunk storage, crash recovery → `../../docs/adr/0002-stream-audio-chunks-to-disk.md`, `../../docs/adr/0003-ffmpeg-wasm-lifecycle.md`
- Sentence splitting, block sizes → `../../docs/adr/0001-native-sentence-segmenter-for-split.md`
- Voice allocation, the 80/20 split, reroll invariance → `../../docs/adr/0006-80-20-unique-shared-voice-allocation.md`
- Filter chain, gap preservation → `../../docs/adr/0004-fixed-audio-filter-chain-order.md`
- Settings persistence → `../../docs/adr/0005-settings-merge-without-migrations.md`
