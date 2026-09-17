# Stream audio chunks to disk

Audio never lives in RAM. Synthesized chunks stream straight to the Chunk store, because holding a long book's audio in memory caused out-of-memory failures.

## Consequences

- Merge reads chunks from disk, and resume skips already-stored chunks. An in-flight worker finishing its save after an abort is harmless.
- The voice profile JSON sidecar in the book output folder is best-effort: a failed write logs a warning and the conversion still completes.
- The output folder and file name must pass the same filename sanitizer the audio output uses; an unsanitized name raises a type-mismatch error when creating the directory on Windows.
