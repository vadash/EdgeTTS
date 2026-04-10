# ChunkStore Implementation Plan

**Goal:** Replace per-chunk file storage with an append-only WAL pattern using two files (`chunks_data.bin` and `chunks_index.jsonl`) to eliminate HDD I/O bottlenecks.

**Architecture:** A single `ChunkStore` class manages both file handles. Writes are serialized through an internal async queue to handle concurrent TTS workers. The index is kept in memory as a `Map<number, {offset, length}>`. On init, the JSONL index file is parsed to rebuild state for crash recovery. Reads use a cached `File` object with `File.slice()` for efficient random access.

**Tech Stack:** TypeScript, File System Access API, Vitest for testing.

---

### File Structure Overview

- Create: `src/services/ChunkStore.ts` - Core ChunkStore class with WAL pattern
- Create: `src/services/ChunkStore.test.ts` - Unit tests for ChunkStore
- Modify: `src/services/TTSWorkerPool.ts` - Replace `writeChunkToDisk()` with `chunkStore.writeChunk()`
- Modify: `src/services/AudioMerger.ts` - Replace `readChunkFromDisk()` with `chunkStore.readChunk()`
- Modify: `src/services/ConversionOrchestrator.ts` - Create ChunkStore, pass to worker pool and merger
- Modify: `src/services/ResumeCheck.ts` - Update resume logic to use new format

---

### Task 1: ChunkStore Core Implementation

**Files:**
- Create: `src/services/ChunkStore.ts`
- Test: `src/services/ChunkStore.test.ts`

**Common Pitfalls:**
- `createWritable({ keepExistingData: true })` positions cursor at byte 0, always `seek()` after opening
- Streams must be closed per batch to commit swap file to disk (crash safety)
- Empty lines in JSONL still consume bytes (the `\n`), don't filter them before counting
- `maxValidOffset` must track the highest `offset + length` across ALL entries, not just the last line

- [ ] Step 1: Write the failing test for basic write/read roundtrip

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkStore } from './ChunkStore';

// Mock File System Access API
class MockFileSystem {
  files = new Map<string, { data: Uint8Array; name: string }>();

  createDirectoryHandle() {
    const files = this.files;
    return {
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        if (!files.has(name) && opts?.create) {
          files.set(name, { data: new Uint8Array(0), name });
        }
        if (!files.has(name)) {
          throw new Error('File not found');
        }
        const file = files.get(name)!;
        return {
          createWritable: async (opts?: { keepExistingData?: boolean }) => {
            let position = 0;
            const existingData = opts?.keepExistingData ? file.data : new Uint8Array(0);
            return {
              write: async (data: Uint8Array | string) => {
                const bytes = typeof data === 'string'
                  ? new TextEncoder().encode(data)
                  : data;
                const before = existingData.slice(0, position);
                const after = existingData.slice(position + bytes.length);
                file.data = new Uint8Array([...before, ...bytes, ...after]);
                position += bytes.length;
              },
              seek: async (offset: number) => { position = offset; },
              truncate: async (size: number) => {
                file.data = file.data.slice(0, size);
              },
              close: async () => {},
            };
          },
          getFile: async () => ({
            text: async () => new TextDecoder().decode(file.data),
            size: file.data.length,
            slice: (start: number, end: number) => ({
              arrayBuffer: async () => file.data.slice(start, end).buffer,
            }),
          }),
        };
      },
    };
  }
}

describe('ChunkStore', () => {
  let mockFs: MockFileSystem;
  let mockDirHandle: FileSystemDirectoryHandle;
  let store: ChunkStore;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    mockDirHandle = mockFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    store = new ChunkStore();
  });

  it('should write and read a chunk', async () => {
    await store.init(mockDirHandle);

    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    await store.writeChunk(0, testData);
    await store.prepareForRead();

    const result = await store.readChunk(0);
    expect(result).toEqual(testData);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/services/ChunkStore.test.ts --reporter=verbose`
Expected: FAIL with "ChunkStore is not defined" or similar

- [ ] Step 3: Write minimal ChunkStore implementation

```typescript
export class ChunkStore {
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private dataHandle: FileSystemFileHandle | null = null;
  private indexHandle: FileSystemFileHandle | null = null;
  private index = new Map<number, { offset: number; length: number }>();
  private currentOffset = 0;
  private currentIndexOffset = 0;
  private cachedFile: File | null = null;
  private textEncoder = new TextEncoder();

  private queue: Array<{ index: number; data: Uint8Array; resolve: () => void }> = [];
  private draining = false;

  async init(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
    this.directoryHandle = directoryHandle;
    this.dataHandle = await directoryHandle.getFileHandle('chunks_data.bin', { create: true });
    this.indexHandle = await directoryHandle.getFileHandle('chunks_index.jsonl', { create: true });
    await this.parseExistingIndex();
  }

  private async parseExistingIndex(): Promise<void> {
    let maxValidOffset = 0;
    let validIndexBytes = 0;

    try {
      const indexFile = await this.indexHandle!.getFile();
      const text = await indexFile.text();
      const lines = text.split('\n');
      let bytePosition = 0;

      for (const line of lines) {
        const lineBytes = this.textEncoder.encode(line + '\n').byteLength;

        if (line.trim().length === 0) {
          bytePosition += lineBytes;
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (typeof entry.i === 'number' && typeof entry.o === 'number' && typeof entry.l === 'number') {
            this.index.set(entry.i, { offset: entry.o, length: entry.l });
            maxValidOffset = Math.max(maxValidOffset, entry.o + entry.l);
            validIndexBytes = bytePosition + lineBytes;
          }
        } catch {
          break;
        }

        bytePosition += lineBytes;
      }
    } catch {
      // Fresh start
    }

    this.currentOffset = maxValidOffset;
    this.currentIndexOffset = validIndexBytes;

    // Truncate to known-good sizes
    if (this.currentOffset > 0 || this.currentIndexOffset > 0) {
      const dataTruncate = await this.dataHandle!.createWritable({ keepExistingData: true });
      await dataTruncate.truncate(this.currentOffset);
      await dataTruncate.close();

      const indexTruncate = await this.indexHandle!.createWritable({ keepExistingData: true });
      await indexTruncate.truncate(this.currentIndexOffset);
      await indexTruncate.close();
    }
  }

  async writeChunk(index: number, data: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ index, data, resolve });
      if (!this.draining) {
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    this.draining = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.queue.length);

      const dataStream = await this.dataHandle!.createWritable({ keepExistingData: true });
      const indexStream = await this.indexHandle!.createWritable({ keepExistingData: true });

      await dataStream.seek(this.currentOffset);
      await indexStream.seek(this.currentIndexOffset);

      for (const item of batch) {
        const offset = this.currentOffset;
        await dataStream.write(item.data);

        const indexLine = JSON.stringify({ i: item.index, o: offset, l: item.data.byteLength }) + '\n';
        await indexStream.write(indexLine);

        this.index.set(item.index, { offset, length: item.data.byteLength });
        this.currentOffset += item.data.byteLength;
        this.currentIndexOffset += this.textEncoder.encode(indexLine).byteLength;
      }

      await dataStream.close();
      await indexStream.close();

      for (const item of batch) {
        item.resolve();
      }
    }

    this.draining = false;
  }

  async prepareForRead(): Promise<void> {
    this.cachedFile = await this.dataHandle!.getFile();
  }

  async readChunk(index: number): Promise<Uint8Array> {
    const entry = this.index.get(index);
    if (!entry) {
      throw new Error(`Chunk ${index} not found`);
    }
    if (!this.cachedFile) {
      throw new Error('Call prepareForRead() before reading');
    }

    const blob = this.cachedFile.slice(entry.offset, entry.offset + entry.length);
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  getExistingIndices(): Set<number> {
    return new Set(this.index.keys());
  }

  async close(): Promise<void> {
    // Drain any pending writes
    if (this.queue.length > 0 && !this.draining) {
      await this.drain();
    }
    this.cachedFile = null;
    this.dataHandle = null;
    this.indexHandle = null;
    this.directoryHandle = null;
  }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/services/ChunkStore.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: add ChunkStore with append-only WAL pattern"
```

---

### Task 2: ChunkStore Concurrent Writes Test

**Files:**
- Modify: `src/services/ChunkStore.test.ts`

- [ ] Step 1: Write the failing test for concurrent writes

Add to `ChunkStore.test.ts`:

```typescript
  it('should handle concurrent writes without data loss', async () => {
    await store.init(mockDirHandle);

    const numWorkers = 15;
    const chunksPerWorker = 10;
    const promises: Promise<void>[] = [];

    for (let worker = 0; worker < numWorkers; worker++) {
      for (let i = 0; i < chunksPerWorker; i++) {
        const index = worker * chunksPerWorker + i;
        const data = new Uint8Array([index, index + 1, index + 2]);
        promises.push(store.writeChunk(index, data));
      }
    }

    await Promise.all(promises);
    await store.prepareForRead();

    // Verify all chunks written correctly
    for (let worker = 0; worker < numWorkers; worker++) {
      for (let i = 0; i < chunksPerWorker; i++) {
        const index = worker * chunksPerWorker + i;
        const result = await store.readChunk(index);
        expect(result).toEqual(new Uint8Array([index, index + 1, index + 2]));
      }
    }
  });
```

- [ ] Step 2: Run test to verify it passes

Run: `npm test -- src/services/ChunkStore.test.ts::"should handle concurrent writes" --reporter=verbose`
Expected: PASS

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test: add concurrent write test for ChunkStore"
```

---

### Task 3: ChunkStore Crash Recovery Test

**Files:**
- Modify: `src/services/ChunkStore.test.ts`

- [ ] Step 1: Write the failing test for crash recovery

Add to `ChunkStore.test.ts`:

```typescript
  it('should recover from crash with torn last line', async () => {
    // Simulate pre-existing data with torn last line
    const dataHandle = await mockDirHandle.getFileHandle('chunks_data.bin', { create: true });
    const indexHandle = await mockDirHandle.getFileHandle('chunks_index.jsonl', { create: true });

    // Write valid data
    const dataWritable = await dataHandle.createWritable();
    await dataWritable.write(new Uint8Array([1, 2, 3, 4, 5]));
    await dataWritable.close();

    // Write valid index followed by torn/truncated line
    const indexWritable = await indexHandle.createWritable();
    await indexWritable.write('{"i":0,"o":0,"l":5}\n');
    await indexWritable.write('{"i":1,"o":5,"l":3}\n');
    await indexWritable.write('{"i":2,"o":'); // torn line
    await indexWritable.close();

    // Create new store and init (should recover)
    const newStore = new ChunkStore();
    await newStore.init(mockDirHandle);
    await newStore.prepareForRead();

    // Should have chunks 0 and 1, not 2
    expect(newStore.getExistingIndices()).toEqual(new Set([0, 1]));

    const chunk0 = await newStore.readChunk(0);
    expect(chunk0).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('should handle empty index file', async () => {
    await mockDirHandle.getFileHandle('chunks_data.bin', { create: true });
    await mockDirHandle.getFileHandle('chunks_index.jsonl', { create: true });

    const newStore = new ChunkStore();
    await newStore.init(mockDirHandle);

    expect(newStore.getExistingIndices()).toEqual(new Set());
  });
```

- [ ] Step 2: Run tests to verify they pass

Run: `npm test -- src/services/ChunkStore.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test: add crash recovery tests for ChunkStore"
```

---

### Task 4: Update ResumeCheck for ChunkStore Format

**Files:**
- Modify: `src/services/ResumeCheck.ts`
- Test: `src/services/ResumeCheck.test.ts` (if exists, else create)

- [ ] Step 1: Write the failing test for legacy detection

Create `src/services/ResumeCheck.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { checkResumeState } from './ResumeCheck';

describe('ResumeCheck', () => {
  it('should return null for legacy chunk files without new format', async () => {
    // Mock directory with old-format files only
    const mockDir = createMockDirectory({
      '_temp_work': {
        'chunk_000000.bin': new Uint8Array([1, 2, 3]),
        'chunk_000001.bin': new Uint8Array([4, 5, 6]),
        'pipeline_state.json': '{"assignments":[]}',
      },
    });

    const result = await checkResumeState(mockDir);
    // Should return null because chunks_index.jsonl doesn't exist (legacy wipe)
    expect(result).toBeNull();
  });

  it('should detect new format with chunks_index.jsonl', async () => {
    const mockDir = createMockDirectory({
      '_temp_work': {
        'chunks_data.bin': new Uint8Array([1, 2, 3, 4, 5]),
        'chunks_index.jsonl': '{"i":0,"o":0,"l":5}\n',
        'pipeline_state.json': '{"assignments":[]}',
      },
    });

    const result = await checkResumeState(mockDir);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(1);
    expect(result!.hasLLMState).toBe(true);
  });
});

// Simple mock factory - expand as needed
function createMockDirectory(structure: Record<string, unknown>): FileSystemDirectoryHandle {
  // Implementation similar to ChunkStore mock
  // ... return mock directory handle
}
```

- [ ] Step 2: Modify ResumeCheck.ts to detect new format

```typescript
// In ResumeCheck.ts, replace countChunkFiles with:

async function countNewFormatChunks(dir: FileSystemDirectoryHandle): Promise<number> {
  try {
    const indexHandle = await dir.getFileHandle('chunks_index.jsonl');
    const indexFile = await indexHandle.getFile();
    const text = await indexFile.text();
    // Count non-empty lines
    return text.split('\n').filter(line => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function hasNewFormat(dir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await dir.getFileHandle('chunks_index.jsonl');
    return true;
  } catch {
    return false;
  }
}

async function hasOldFormat(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.startsWith('chunk_') && name.endsWith('.bin')) {
      return true;
    }
  }
  return false;
}

// Update checkResumeState:
export async function checkResumeState(
  dirHandle: FileSystemDirectoryHandle,
  log?: (msg: string) => void,
): Promise<ResumeCheckResult> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) {
    log?.('Resume check: no _temp_work directory found');
    return null;
  }

  // Legacy detection: old format present but no new format index
  const hasNew = await hasNewFormat(tempDir);
  const hasOld = await hasOldFormat(tempDir);

  if (hasOld && !hasNew) {
    log?.('Resume check: legacy format detected, wiping for fresh start');
    // Wipe temp directory
    try {
      await dirHandle.removeEntry('_temp_work', { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }

  const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');
  const cachedChunks = hasNew ? await countNewFormatChunks(tempDir) : 0;

  if (cachedChunks === 0 && !hasLLMState) {
    log?.('Resume check: no resumable state found');
    return null;
  }

  log?.(
    `Resume check: resumable state found (${cachedChunks} cached chunks, LLM state: ${hasLLMState})`,
  );
  return {
    cachedChunks,
    hasLLMState,
  };
}
```

- [ ] Step 3: Run tests to verify

Run: `npm test -- src/services/ResumeCheck.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat: update ResumeCheck for ChunkStore format with legacy detection"
```

---

### Task 5: Integrate ChunkStore into TTSWorkerPool

**Files:**
- Modify: `src/services/TTSWorkerPool.ts`
- Modify: `src/services/TTSWorkerPool.test.ts`

- [ ] Step 1: Update TTSWorkerPool constructor and options

```typescript
// Add to WorkerPoolOptions:
export interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  directoryHandle?: FileSystemDirectoryHandle | null;
  chunkStore?: ChunkStore | null;  // NEW
  onStatusUpdate?: (update: StatusUpdate) => void;
  // ... rest
}

// In TTSWorkerPool class, replace tempDirHandle with chunkStore:
export class TTSWorkerPool {
  // ... existing fields ...
  private chunkStore: ChunkStore | null = null;  // REPLACE tempDirHandle
  // ...

  constructor(options: WorkerPoolOptions) {
    // ... existing init ...
    this.chunkStore = options.chunkStore ?? null;  // NEW
    // Remove initTempDirectory and initPromise - ChunkStore is already initialized
  }

  // Remove initTempDirectory(), writeChunkToDisk() methods entirely

  // Update executeTask:
  private async executeTask(task: PoolTask): Promise<void> {
    // Remove: if (this.initPromise) { await this.initPromise; }

    // ... rest of task execution ...

    // Replace writeChunkToDisk with:
    await this.chunkStore!.writeChunk(task.partIndex, audioData);

    // ... rest ...
  }

  // Remove getTempDirHandle() - no longer needed externally
  // Keep cleanup() but simplify - just close chunkStore, directory removal handled by orchestrator
}
```

- [ ] Step 2: Update tests

In `TTSWorkerPool.test.ts`, update mocks to provide ChunkStore instead of directory handle expectations.

- [ ] Step 3: Run tests

Run: `npm test -- src/services/TTSWorkerPool.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "refactor: integrate ChunkStore into TTSWorkerPool"
```

---

### Task 6: Integrate ChunkStore into AudioMerger

**Files:**
- Modify: `src/services/AudioMerger.ts`
- Modify: `src/services/AudioMerger.test.ts`

- [ ] Step 1: Update AudioMerger constructor

```typescript
export interface MergerConfig {
  // ... existing fields ...
  chunkStore?: ChunkStore | null;  // NEW
}

export class AudioMerger {
  // ... existing fields ...
  private chunkStore: ChunkStore | null = null;  // NEW

  constructor(ffmpegService: FFmpegService, config: MergerConfig) {
    this.ffmpegService = ffmpegService;
    this.config = config;
    this.chunkStore = config.chunkStore ?? null;  // NEW
    // ... rest ...
  }

  // Remove readChunkFromDisk() method entirely

  // Update getDurationMs:
  private async getDurationMs(index: number): Promise<number> {
    try {
      const audio = await this.chunkStore!.readChunk(index);
      const parsedDuration = parseMP3Duration(audio);
      if (parsedDuration !== null && parsedDuration > 0) {
        return parsedDuration;
      }
      return this.estimateDurationMsFallback(audio.length);
    } catch {
      return 0;
    }
  }

  // Update calculateMergeGroups - remove tempDirHandle parameter:
  async calculateMergeGroups(
    audioMap: Map<number, string>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    // REMOVE: tempDirHandle: FileSystemDirectoryHandle,
  ): Promise<MergeGroup[]> {
    // ... existing logic ...
    // Update getDurationMs call to remove tempDirHandle
  }

  // Update mergeAudioGroupAsync - remove tempDirHandle parameter, use chunkStore:
  private async mergeAudioGroupAsync(
    audioMap: Map<number, string>,
    group: MergeGroup,
    totalGroups: number,
    // REMOVE: tempDirHandle: FileSystemDirectoryHandle,
    onProgress?: (message: string) => void,
  ): Promise<MergedFile | null> {
    const chunks: (Uint8Array | null)[] = [];
    // ...
    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      // Replace readChunkFromDisk with:
      try {
        const audio = await this.chunkStore!.readChunk(i);
        chunks.push(audio);
      } catch {
        chunks.push(null);
      }
    }
    // ... rest ...
  }

  // Update mergeAndSave signature - remove tempDirHandle parameter:
  async mergeAndSave(
    audioMap: Map<number, string>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    // REMOVE: tempDirHandle: FileSystemDirectoryHandle,
    saveDirectoryHandle: FileSystemDirectoryHandle,
    onProgress?: MergeProgressCallback,
  ): Promise<number> {
    // Update calculateMergeGroups call
    const groups = await this.calculateMergeGroups(audioMap, totalSentences, fileNames);
    // ...
    // Update mergeAudioGroupAsync call
  }
}
```

- [ ] Step 2: Update tests

In `AudioMerger.test.ts`, update to mock ChunkStore instead of file system.

- [ ] Step 3: Run tests

Run: `npm test -- src/services/AudioMerger.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "refactor: integrate ChunkStore into AudioMerger"
```

---

### Task 7: Update ConversionOrchestrator

**Files:**
- Modify: `src/services/ConversionOrchestrator.ts`

- [ ] Step 1: Add ChunkStore import and update orchestrator

```typescript
// Add import:
import { ChunkStore } from './ChunkStore';

// In runConversion function, after resume check:
async function runConversion(...) {
  // ... existing resume check code ...

  // Create ChunkStore after resume decision
  const chunkStore = new ChunkStore();
  const tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work', { create: true });
  await chunkStore.init(tempDirHandle);

  // Pass chunkStore to worker pool
  const workerPool = workerPoolFactory.create({
    maxWorkers: input.ttsThreads,
    config: ttsConfig,
    directoryHandle: directoryHandle,
    chunkStore: chunkStore,  // NEW
    // ... rest ...
  });

  // In TTS stage, pass chunkStore to merger
  const merger = audioMergerFactory.create({
    outputFormat: 'opus',
    // ... existing config ...
    chunkStore: chunkStore,  // NEW
  });

  // Before merge, call prepareForRead
  await chunkStore.prepareForRead();

  // In mergeAndSave call, remove tempDirHandle parameter
  const savedCount = await merger.mergeAndSave(
    audioMap,
    totalChunks,
    fileNames,
    // REMOVE: tempDirHandle,
    directoryHandle,
    (current, total, message) => { ... }
  );

  // In cleanup, close chunkStore
  await chunkStore.close();
  await cleanupTemp(directoryHandle, logger);
}
```

- [ ] Step 2: Update audioMergerFactory type

```typescript
export interface ConversionOrchestratorServices {
  // ...
  audioMergerFactory: {
    create(config: import('./AudioMerger').MergerConfig & { chunkStore: ChunkStore }): AudioMerger;
  };
  // ...
}
```

- [ ] Step 3: Run type check

Run: `npm run typecheck`
Expected: No errors

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "refactor: integrate ChunkStore into ConversionOrchestrator"
```

---

### Task 8: Integration Tests

**Files:**
- Create: `src/services/__tests__/ChunkStore.integration.test.ts`

- [ ] Step 1: Write integration test

```typescript
import { describe, it, expect } from 'vitest';
import { ChunkStore } from '../ChunkStore';

describe('ChunkStore Integration', () => {
  it('should handle full write-then-read cycle with out-of-order writes', async () => {
    const mockDir = createMockDirectory(); // Same mock as unit tests
    const store = new ChunkStore();
    await store.init(mockDir);

    // Simulate TTS workers completing out of order
    const writes = [
      store.writeChunk(5, new Uint8Array([5, 5, 5])),
      store.writeChunk(0, new Uint8Array([0, 0, 0])),
      store.writeChunk(10, new Uint8Array([10, 10, 10])),
      store.writeChunk(2, new Uint8Array([2, 2, 2])),
      store.writeChunk(7, new Uint8Array([7, 7, 7])),
    ];

    await Promise.all(writes);
    await store.prepareForRead();

    // Read in sequential order (merge phase)
    const chunk0 = await store.readChunk(0);
    const chunk2 = await store.readChunk(2);
    const chunk5 = await store.readChunk(5);
    const chunk7 = await store.readChunk(7);
    const chunk10 = await store.readChunk(10);

    expect(chunk0).toEqual(new Uint8Array([0, 0, 0]));
    expect(chunk2).toEqual(new Uint8Array([2, 2, 2]));
    expect(chunk5).toEqual(new Uint8Array([5, 5, 5]));
    expect(chunk7).toEqual(new Uint8Array([7, 7, 7]));
    expect(chunk10).toEqual(new Uint8Array([10, 10, 10]));
  });

  it('should resume from existing state', async () => {
    const mockDir = createMockDirectory();

    // First session: write some chunks
    const store1 = new ChunkStore();
    await store1.init(mockDir);
    await store1.writeChunk(0, new Uint8Array([1, 2, 3]));
    await store1.writeChunk(1, new Uint8Array([4, 5, 6]));
    await store1.close();

    // Second session: resume and add more
    const store2 = new ChunkStore();
    await store2.init(mockDir);

    expect(store2.getExistingIndices()).toEqual(new Set([0, 1]));

    await store2.writeChunk(2, new Uint8Array([7, 8, 9]));
    await store2.prepareForRead();

    const chunk0 = await store2.readChunk(0);
    const chunk1 = await store2.readChunk(1);
    const chunk2 = await store2.readChunk(2);

    expect(chunk0).toEqual(new Uint8Array([1, 2, 3]));
    expect(chunk1).toEqual(new Uint8Array([4, 5, 6]));
    expect(chunk2).toEqual(new Uint8Array([7, 8, 9]));
  });
});
```

- [ ] Step 2: Run integration tests

Run: `npm test -- src/services/__tests__/ChunkStore.integration.test.ts --reporter=verbose`
Expected: PASS

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test: add ChunkStore integration tests"
```

---

### Task 9: Run Full Test Suite

- [ ] Step 1: Run all tests

```bash
npm test
```
Expected: All tests pass

- [ ] Step 2: Run type check

```bash
npm run typecheck
```
Expected: No type errors

- [ ] Step 3: Run lint

```bash
npm run lint
```
Expected: No lint errors

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "chore: verify full test suite passes with ChunkStore"
```

---

## Summary

This plan implements the ChunkStore with:

1. **Core ChunkStore class** (Task 1) - WAL pattern with append-only data file and JSONL index
2. **Concurrent write handling** (Task 2) - Queue-based serialization for TTS workers
3. **Crash recovery** (Task 3) - Parse index with validation, truncate to known-good state
4. **ResumeCheck updates** (Task 4) - Legacy format detection and wipe
5. **TTSWorkerPool integration** (Task 5) - Replace per-file writes with ChunkStore
6. **AudioMerger integration** (Task 6) - Replace per-file reads with ChunkStore
7. **Orchestrator wiring** (Task 7) - Create, pass, and manage ChunkStore lifecycle
8. **Integration tests** (Task 8) - End-to-end scenarios
9. **Verification** (Task 9) - Full test suite validation

After completing these tasks, the TTS pipeline will use two files (`chunks_data.bin`, `chunks_index.jsonl`) instead of thousands of individual `chunk_XXXXXX.bin` files, eliminating the HDD I/O bottleneck.
