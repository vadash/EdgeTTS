# FFmpeg and Storage Gotchas

Memory, encoding, and crash-recovery rules for the audio stage.

## Memory

- Never hold audio in RAM. Stream chunks straight to the chunk store in the temporary work folder.
- The app writes to disk directly to avoid out-of-memory failures on long books.

## FFmpeg lifecycle

- Each FFmpeg instance terminates and reloads itself after 10 operations, to release leaked memory.
- The operation counter is per instance. Pool workers start their own count.
- Loading tries three tiers in order: cached blob URL, IndexedDB, then network.
- Core blob URLs are cached at module scope, so every instance reuses the first successful load.
- Only an in-memory tier failure clears the cached blob URLs. Terminating an instance does not.

## Filter chain

- Filter order is fixed: de-esser, silence removal, loudness normalization, then fade.
- Silence removal must run before loudness normalization, so trimming uses source levels.
- EQ and compressor default to off for new users. Edge TTS speech is already clean and level.
- The de-esser stays on by default, to control harsh sibilance.
- Saved user settings survive through the storage merge pattern. Do not add a settings migration.

## Gap preservation

- Deliberate silence files are inserted between chunks before the filter chain runs.
- The silence-removal stop duration is clamped to at least the configured gap length.
- Keep gap insertion and that clamp in sync, or the gap setting breaks silently at larger values.

## Parallel merge pool

- Merge groups run on a pool of FFmpeg instances. The size is the user setting, capped at 4.
- The injected singleton is always the first worker and keeps its own lifecycle rules.
- Extra workers come from a factory and are terminated in a finally block after the merge.
- The pool spawns no more workers than there are pending groups.
- The first rejection aborts the batch. In-flight workers may still finish and save, which is harmless because resume skips existing files.
- The FFmpeg core is single-threaded WASM. More than 4 workers loses to disk I/O and core contention.

## Voice profile output

- The voice profile is written as a JSON file inside the book output folder.
- The folder and file name must pass through the same filename sanitizer the audio output uses.
- An unsanitized name raises a type-mismatch error when creating the directory on Windows.
- The profile write is best-effort. A failure logs a warning and the conversion still completes.
