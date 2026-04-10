# Chunk Store: Append-Only Container for TTS Audio Chunks

## Problem

The current pipeline stores each TTS audio chunk as an individual file (`chunk_XXXXXX.bin`) in a `_temp_work/` directory via the File System Access API. A typical book produces 3,000-10,000 chunks; large books can reach 100,000.

On HDDs, this creates severe I/O bottlenecks:

- **Merge startup:** Reading 9,000+ files requires 9,000+ directory lookups, `getFileHandle` calls, opens, reads, and closes. Each operation incurs ~10ms seek latency on HDD, totaling minutes of pure overhead.
- **Resume:** Scanning the directory to determine which chunks already exist suffers the same enumeration cost.
- **Cleanup:** Deleting 9,000+ files is itself slow on HDD.

The bottleneck is **file count**, not total data size. The solution: consolidate into **two files**.

## Design

Replace the per-chunk file approach with an append-only Write-Ahead Log (WAL) pattern — the same strategy used by PostgreSQL and SQLite for high-throughput sequential writes.

### Storage Format

Two files in `_temp_work/`:

1. **`chunks_data.bin`** — raw concatenated MP3 bytes, append-only.
2. **`chunks_index.jsonl`** — JSON Lines index, one entry per chunk:

```json
{"i":0,"o":0,"l":4823}
{"i":1,"o":4823,"l":3102}
{"i":2,"o":7925,"l":5440}
```

Fields: `i` = chunk index, `o` = byte offset in `chunks_data.bin`, `l` = byte length.

Index size: ~25 bytes per line. 100,000 chunks ≈ 2.5 MB. Trivial to parse.

### New Component: `ChunkStore`

File: `src/services/ChunkStore.ts`

Single class that owns both file handles and exposes three operations:

```typescript
class ChunkStore {
  // Open/create both files. Parse index for existing state (resume).
  async init(directoryHandle: FileSystemDirectoryHandle): Promise<void>

  // Write a chunk. Serialized via internal queue. Returns when persisted.
  async writeChunk(index: number, data: Uint8Array): Promise<void>

  // Read a chunk by index. Uses File.slice() on the data file.
  async readChunk(index: number): Promise<Uint8Array>

  // Return set of already-written chunk indices (for resume).
  getExistingIndices(): Set<number>

  // Close file handles.
  async close(): Promise<void>
}
```

**Internal state:**
- `Map<number, {offset: number, length: number}>` — in-memory index built from the JSONL file on init.
- `FileSystemFileHandle` + `FileSystemWritableFileStream` for each file (data and index).
- An async drain queue for serializing concurrent writes from multiple TTS workers.

### Writer Queue

TTS workers run concurrently (up to 15). The File System Access API does not support concurrent writes to a single `FileSystemWritableFileStream`. The writer queue serializes all writes:

```typescript
private queue: Array<{index: number, data: Uint8Array, resolve: () => void}> = []
private draining = false

async writeChunk(index: number, data: Uint8Array): Promise<void> {
  return new Promise(resolve => {
    this.queue.push({ index, data, resolve })
    if (!this.draining) void this.drain()
  })
}

private async drain(): Promise<void> {
  this.draining = true
  while (this.queue.length > 0) {
    const batch = this.queue.splice(0, this.queue.length)
    for (const item of batch) {
      const offset = this.currentOffset
      await this.dataStream.write(item.data)
      const indexLine = JSON.stringify({ i: item.index, o: offset, l: item.data.byteLength }) + '\n'
      await this.indexStream.write(indexLine)
      this.index.set(item.index, { offset, length: item.data.byteLength })
      this.currentOffset += item.data.byteLength
    }
    // Flush after each batch to ensure crash safety
    // (streams auto-flush on close, but explicit flush ensures data is on disk)
    for (const item of batch) {
      item.resolve()
    }
  }
  this.draining = false
}
```

The queue takes all pending items at once, writes them sequentially, and resolves all promises. This batches writes naturally when workers produce chunks faster than the drain loop processes them.

### Chunk Reading (Merge Phase)

```typescript
async readChunk(index: number): Promise<Uint8Array> {
  const entry = this.index.get(index)
  if (!entry) throw new Error(`Chunk ${index} not found`)

  const file = await this.dataHandle.getFile()
  const blob = file.slice(entry.offset, entry.offset + entry.length)
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}
```

`File.slice()` is handled natively by the OS. When chunks are read in order during merge, the HDD performs sequential reads within a single file — no directory lookups, no file open/close per chunk.

Note: `getFile()` returns a snapshot. For merge groups reading hundreds of chunks, calling `getFile()` once per group (not per chunk) is sufficient since the data file is closed for writing at that point.

### Crash-Safe Resume

On init, `ChunkStore` reads `chunks_index.jsonl` line by line:

```typescript
async init(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
  // Open/create data file for append
  this.dataHandle = await directoryHandle.getFileHandle('chunks_data.bin', { create: true })
  this.dataStream = await this.dataHandle.createWritable({ keepExistingData: true })

  // Open/create index file for append
  this.indexHandle = await directoryHandle.getFileHandle('chunks_index.jsonl', { create: true })

  // Parse existing index
  try {
    const indexFile = await this.indexHandle.getFile()
    const text = await indexFile.text()
    const lines = text.split('\n').filter(line => line.trim().length > 0)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (typeof entry.i === 'number' && typeof entry.o === 'number' && typeof entry.l === 'number') {
          this.index.set(entry.i, { offset: entry.o, length: entry.l })
        }
      } catch {
        // Torn/truncated last line — discard
        break
      }
    }
  } catch {
    // File doesn't exist yet — fresh start
  }

  // Position append offset after last valid chunk
  this.currentOffset = this.computeMaxOffset()

  // Truncate data file to last valid offset (discard trailing garbage from partial write)
  // Re-open stream positioned at end of valid data
  this.indexStream = await this.indexHandle.createWritable({ keepExistingData: true })
  // Seek to end of valid index data...
}
```

Key properties:
- A torn write (power loss, tab crash) can only corrupt the **last line** of the JSONL file.
- Each line is validated with `JSON.parse` + field type checks. Anything that fails is discarded along with all subsequent lines.
- The data file's valid region is derived from the last valid index entry's `offset + length`.
- Resume completes in one read of the JSONL file instead of 100,000 directory listings.

### Component Changes

#### `TTSWorkerPool`

Current: `writeChunkToDisk()` creates `chunk_XXXXXX.bin` per chunk via `directoryHandle.getFileHandle()`.

Change: Replace with `this.chunkStore.writeChunk(partIndex, audioData)`. Remove all per-file handle logic.

#### `AudioMerger`

Current: `readChunkFromDisk()` opens individual chunk files.

Change: Replace with `this.chunkStore.readChunk(index)`. The method returns a `Uint8Array` — same as current code expects.

#### `ConversionOrchestrator`

Current: Scans `_temp_work/` directory entries to find existing chunks for resume.

Change: `chunkStore.getExistingIndices()` returns a `Set<number>` directly. No directory scanning.

Current: Creates and passes directory handle to workers.

Change: Creates `ChunkStore`, calls `init()`, passes the store instance to `TTSWorkerPool` and `AudioMerger`.

#### `ResumeCheck`

Current: Enumerates `_temp_work/` files and parses `chunk_\d+\.bin` filenames.

Change: Reads `chunks_index.jsonl` directly (or delegates to `ChunkStore.getExistingIndices()`).

### Cleanup

Unchanged in interface: `cleanupTemp()` removes the `_temp_work/` directory. Internally, `ChunkStore.close()` is called first to flush and close streams. The directory then contains only 2 files instead of 100,000 — deletion is near-instant.

### Testing Strategy

| Test | What it verifies |
|------|-----------------|
| `ChunkStore` write + read roundtrip | Data integrity: bytes written = bytes read |
| Concurrent writes (simulate 15 workers) | No data loss, no interleaving, correct offsets |
| Crash recovery: torn last line | Only valid entries recovered, trailing garbage ignored |
| Crash recovery: empty index file | Fresh start, no errors |
| Resume: partial pipeline | `getExistingIndices()` returns correct set |
| Full pipeline integration | End-to-end: synthesis → merge produces identical Opus output |

## Migration

The old per-chunk-file format is **not** backward-compatible. When a user starts a new conversion, the new `ChunkStore` format is used. Any in-progress conversion using the old format will need to restart (the `_temp_work/` directory is ephemeral by design — it's deleted on completion anyway).

No fallback, no dual-mode. Clean cut.
