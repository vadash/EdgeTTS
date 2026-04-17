# Hybrid IDB + Disk ChunkStore

**Date:** 2026-04-17
**Status:** Approved

## Problem

The current `ChunkStore` appends to a single `chunks_data.bin` file using `createWritable({ keepExistingData: true })`. Each write forces Chrome to copy the entire existing file into a `.crswap` temporary before appending. As the file grows throughout a conversion:

- A 500MB file requires copying 500MB **per append batch**
- Total I/O is **O(N^2)** — the death spiral
- Conversion slows to a crawl for large books (10,000+ chunks)

## Solution

Replace the single-file append pattern with a hybrid IndexedDB + disk buffer:

1. **Write phase:** Chunks go into IndexedDB first (O(1) per chunk, no file system involvement)
2. **Flush phase:** Every 2000 chunks, flush the IDB buffer to a **brand new** numbered `.bin` file with `keepExistingData: false` — no copy, no `.crswap`
3. **Read phase:** Sequential reads from numbered `.bin` files via offset index, same slicing pattern as today

## Architecture

```
TTS Workers ──writeChunk()──▶ IndexedDB Buffer
                                    │
                          count >= 2000?
                                    │ yes (background flush)
                                    ▼
                              ┌──────────────┐
                              │ New Files:    │
                              │ data_N.bin    │  keepExistingData: false
                              │ index_N.jsonl │  → NO .crswap
                              └──────────────┘
                                    │
                                    ▼  (merge stage)
                              RAM Index + File Cache
                              readChunk(i) → slice from cached File
```

### Disk Layout

```
_temp_work/
  chunks_data_0.bin        # Flush batch 0: raw audio concatenated
  chunks_index_0.jsonl     # Flush batch 0: {"i":0,"o":0,"l":42000}\n...
  chunks_data_1.bin        # Flush batch 1
  chunks_index_1.jsonl
  ...
  pipeline_state.json      # Unchanged
  failed_chunks.json       # Unchanged
```

Each index JSONL line: `{"i":<chunkIndex>,"o":<byteOffset>,"l":<byteLength>}`

### RAM Index

```typescript
private index = new Map<number, {
  file: string;   // "chunks_data_0.bin" or "idb"
  offset: number;
  length: number;
}>();
```

Populated at `init()` by scanning both disk index files AND IDB contents. Always in memory. `getExistingIndices()` stays synchronous.

## Components

### IndexedDB Layer

- Database: `edgetts_hybrid_chunks`
- Object store: `chunks`
- Key: chunk index (number)
- Value: Uint8Array
- No secondary indexes, no complexity

### Flush Mechanism

When pending IDB count hits `FLUSH_THRESHOLD` (2000), `flushToDisk()` fires in the background:

1. Snapshot all IDB keys
2. Create fresh `chunks_data_N.bin` + `chunks_index_N.jsonl` (N = incrementing file counter)
3. Write chunks sequentially, build index entries
4. Close both files (atomic commit point)
5. Delete flushed keys from IDB
6. Update RAM index to point to disk file + offset

If more chunks accumulated during flush, another flush triggers automatically.

### Read Path

Unchanged pattern from current implementation:

1. `prepareForRead()` — ensures all IDB chunks are flushed to disk, then caches `File` objects
2. `readChunk(i)` — looks up file/offset/length from RAM index, slices from cached `File` object
3. Small `Map<string, File>` cache for the numbered data files instead of a single cached file

### Public Interface (Unchanged)

```typescript
class ChunkStore {
  init(directoryHandle: FileSystemDirectoryHandle): Promise<void>
  writeChunk(index: number, data: Uint8Array): Promise<void>
  prepareForRead(): Promise<void>
  readChunk(index: number): Promise<Uint8Array>
  getExistingIndices(): Set<number>
  close(): Promise<void>
}
```

No changes to `ConversionOrchestrator`, `TTSWorkerPool`, `AudioMerger`, or `ResumeCheck`.

## Crash Safety

| Crash point | State on recovery |
|---|---|
| IDB write lost | Chunk missing. TTS re-generates it on resume. |
| Mid-flush (stream open) | `.bin` file incomplete, `.crswap` discarded on startup. Chunks still in IDB — re-flushed. |
| After flush close, before IDB delete | Chunks exist in both IDB and on disk. `init()` scans both, RAM index points to disk copy. IDB copy cleaned up on next flush. |
| After IDB delete | Normal state. Disk has the data. |

Key invariant: **data is never deleted from IDB until it's safely committed to disk.**

## Migration

**No migration from old format.** If `init()` detects the old format (`chunks_data.bin` exists), wipe all ChunkStore files except `pipeline_state.json` and `failed_chunks.json`. Resume picks up from the finished LLM data and re-runs TTS from scratch.

Detection: `chunks_data.bin` file exists → old format → wipe.

Files preserved:
- `pipeline_state.json` (LLM results)
- `failed_chunks.json` (failure tracking)

Files deleted:
- `chunks_data.bin`
- `chunks_index.jsonl`
- `*.crswap`
- `chunks_data_*.bin` / `chunks_index_*.jsonl` (if any from previous new-format runs)

IDB database (`edgetts_hybrid_chunks`) is created fresh each session — no cleanup needed for old data since the DB name is new.

## What Gets Removed

From the old implementation:
- Single `chunks_data.bin` / `chunks_index.jsonl` file pair
- `dataHandle` / `indexHandle` persistent file handles
- `queue` / `drain()` batch write system (IDB handles queuing natively)
- Torn-write truncation recovery (new files don't have partial writes — they either commit or don't exist)
- `.crswap` cleanup for the old file names

## Flush Threshold

`FLUSH_THRESHOLD = 2000` chunks.

With typical Edge TTS audio (~5-10KB per chunk):
- 2000 chunks ≈ 10-20MB per flush file
- IDB holds at most ~20MB at any time
- Number of files for a 10,000-chunk book: 5 data + 5 index files

This is a reasonable default. Not configurable — YAGNI.
