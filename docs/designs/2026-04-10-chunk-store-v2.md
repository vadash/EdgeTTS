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

  // Read a chunk by index. Uses File.slice() on the cached File object.
  async readChunk(index: number): Promise<Uint8Array>

  // Cache the File snapshot once before merge starts. Must be called after all writes complete.
  async prepareForRead(): Promise<void>

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

    // Open streams for this batch (commit-on-close guarantees crash safety).
    // Keeping streams open for the entire session would lose all data on crash,
    // because createWritable() writes to a hidden swap file that only replaces
    // the real file on .close().
    const dataStream = await this.dataHandle.createWritable({ keepExistingData: true })
    const indexStream = await this.indexHandle.createWritable({ keepExistingData: true })

    for (const item of batch) {
      const offset = this.currentOffset
      await dataStream.write(item.data)
      const indexLine = JSON.stringify({ i: item.index, o: offset, l: item.data.byteLength }) + '\n'
      await indexStream.write(indexLine)
      this.index.set(item.index, { offset, length: item.data.byteLength })
      this.currentOffset += item.data.byteLength
    }

    // Close both streams — this commits the swap file to disk.
    await dataStream.close()
    await indexStream.close()

    for (const item of batch) {
      item.resolve()
    }
  }
  this.draining = false
}
```

**Why streams are opened and closed per batch, not held open:**

The File System Access API's `createWritable()` writes to a hidden temporary swap file. The target file (`chunks_data.bin`) is only updated when `.close()` is called. If the browser crashes while a stream is open, everything written since the last `.close()` is lost. Opening/closing per batch guarantees that a crash only loses at most the current in-flight batch.

The queue takes all pending items at once, writes them sequentially, and resolves all promises. This batches writes naturally when workers produce chunks faster than the drain loop processes them. The overhead of opening two file handles per batch is negligible compared to the actual I/O of writing audio data.

### Chunk Reading (Merge Phase)

```typescript
private cachedFile: File | null = null

// Call once after all writes complete, before merge starts.
async prepareForRead(): Promise<void> {
  this.cachedFile = await this.dataHandle.getFile()
}

async readChunk(index: number): Promise<Uint8Array> {
  const entry = this.index.get(index)
  if (!entry) throw new Error(`Chunk ${index} not found`)
  if (!this.cachedFile) throw new Error('Call prepareForRead() before reading')

  const blob = this.cachedFile.slice(entry.offset, entry.offset + entry.length)
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}
```

**Why `prepareForRead()` exists:** `dataHandle.getFile()` crosses the main-thread-to-browser-process IPC boundary. Calling it inside `readChunk()` for 9,000+ chunks adds measurable overhead. `prepareForRead()` calls it once, caches the resulting `File` object, and all subsequent `.slice()` calls operate on that cached reference — zero IPC during the merge loop.

`File.slice()` is handled natively by the OS. Within a single file, the OS page cache and read-ahead buffers handle non-sequential offset jumps efficiently. It is still orders of magnitude faster than resolving 9,000 distinct file inodes.

**Note on read access patterns:** TTS workers complete chunks out of order, so `chunks_data.bin` stores audio in completion order, not chronological story order. When `AudioMerger` reads chunks 0, 1, 2, 3 sequentially, the byte offsets will jump around within the data file. This is expected and acceptable — single-file offset jumps are trivially handled by the OS page cache compared to per-file inode resolution.

### Crash-Safe Resume

On init, `ChunkStore` reads `chunks_index.jsonl` line by line:

```typescript
async init(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
  this.directoryHandle = directoryHandle
  this.dataHandle = await directoryHandle.getFileHandle('chunks_data.bin', { create: true })
  this.indexHandle = await directoryHandle.getFileHandle('chunks_index.jsonl', { create: true })

  let maxValidOffset = 0

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
          maxValidOffset = Math.max(maxValidOffset, entry.o + entry.l)
        }
      } catch {
        // Torn/truncated last line — discard it and stop
        break
      }
    }
  } catch {
    // File doesn't exist yet — fresh start
  }

  // Position append offset after the highest valid byte
  // (NOT just the last line — chunks are written out of order, so
  // the last JSONL line does not necessarily have the highest offset)
  this.currentOffset = maxValidOffset
}
```

Key properties:
- A torn write (power loss, tab tab crash) can only corrupt the **last line** of the JSONL file.
- Each line is validated with `JSON.parse` + field type checks. Anything that fails is discarded along with all subsequent lines.
- **`maxValidOffset` tracks the highest `offset + length` across all valid entries**, not just the last line. Since TTS workers complete chunks out of order, the last JSONL line is not guaranteed to have the highest byte offset. Using the running max ensures no valid data is overwritten on resume.
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

The old per-chunk-file format is **not** backward-compatible. When a user starts a new conversion, the new `ChunkStore` format is used.

**Legacy detection in `ResumeCheck`:** If `_temp_work/` contains `chunk_XXXXXX.bin` files (old format) but no `chunks_index.jsonl` (new format), the directory is wiped clean and the conversion starts fresh. This prevents crashes from stale format state. The `_temp_work/` directory is ephemeral by design — it's deleted on completion anyway — so losing an in-progress old-format resume is acceptable.

No fallback, no dual-mode. Clean cut.
