# The Chunk store owns the work folder

The `_temp_work` folder, every chunk file format in it (the numbered `chunks_index_N.jsonl` / `chunks_data_N.bin` pairs and both legacy generations), and the IndexedDB write buffer are implementation details of one module: `ChunkStore`. Callers ask the Chunk store — `snapshot`, `peekWorkFolder`, `ensureWorkFolder`, `wipe`, `clearAll`, `init`, `workFolder` — instead of creating, removing, or parsing the folder themselves. `pipeline_state.json` stays owned by resume policy (`ResumeCheck`) and `failed_chunks.json` by `FailureLog`; both receive the folder handle from the Chunk store. `ChunkIDB` arrives as an injected adapter (default: the real module functions), so tests run the real Chunk store over an in-memory fake instead of whole-module mocks.

## Consequences

- Chunk format, naming, or legacy-migration changes touch only `ChunkStore`; resume asks `snapshot()` (`{ chunkCount, legacyOnly }`) and never learns file names.
- `wipe` (folder removal only) is distinct from `clearAll` (wipe + IndexedDB clear when a session is open); `flushToDisk` drains IDB to disk, so post-run IDB holds only the unflushed tail; keeping the split preserves behavior.
- The folder is addressed by name in exactly one file; remaining mentions in ResumeCheck are frozen log text.
- Deliberately not a standalone WorkFolder seam module and not an absorption of pipeline state or the failure log: both tenants are already deep modules (2026-09 architecture review).
