import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChunkStore } from './ChunkStore';

// Mock ChunkIDB module
vi.mock('./ChunkIDB', () => ({
  openDatabase: vi.fn(),
  putChunk: vi.fn(),
  getAllChunks: vi.fn(),
  getAllKeys: vi.fn(),
  getChunk: vi.fn(),
  getChunksByKeys: vi.fn(),
  deleteKeys: vi.fn(),
  clearDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));

import {
  openDatabase,
  putChunk,
  getAllChunks,
  getAllKeys,
  getChunk,
  getChunksByKeys,
  deleteKeys,
  clearDatabase,
  closeDatabase,
} from './ChunkIDB';

// Mock File System Access API — supports multiple numbered files
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
          createWritable: async (_opts?: { keepExistingData?: boolean }) => {
            let position = 0;
            return {
              write: async (data: Uint8Array | string) => {
                const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                const currentData = file.data;
                const before = currentData.slice(0, position);
                const after = currentData.slice(position + bytes.length);
                file.data = new Uint8Array([...before, ...bytes, ...after]);
                position += bytes.length;
              },
              seek: async (offset: number) => {
                position = offset;
              },
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
      values: async function* () {
        for (const [name] of files) {
          yield { kind: 'file' as const, name };
        }
      },
      removeEntry: async (name: string) => {
        files.delete(name);
      },
    };
  }
}

describe('ChunkStore', () => {
  let mockFs: MockFileSystem;
  let mockDirHandle: FileSystemDirectoryHandle;
  let store: ChunkStore;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs = new MockFileSystem();
    mockDirHandle = mockFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    store = new ChunkStore();

    mockDb = {};
    vi.mocked(openDatabase).mockResolvedValue(mockDb as any);
    vi.mocked(putChunk).mockResolvedValue(undefined);
    vi.mocked(getAllChunks).mockResolvedValue([]);
    vi.mocked(getAllKeys).mockResolvedValue([]);
    vi.mocked(getChunk).mockResolvedValue(undefined);
    vi.mocked(getChunksByKeys).mockResolvedValue([]);
    vi.mocked(deleteKeys).mockResolvedValue(undefined);
    vi.mocked(clearDatabase).mockResolvedValue(undefined);
    vi.mocked(closeDatabase).mockResolvedValue(undefined);
  });

  describe('init', () => {
    it('should open IDB database on init', async () => {
      await store.init(mockDirHandle);
      expect(openDatabase).toHaveBeenCalled();
    });

    it('should migrate old format files on init', async () => {
      // Create old-format files
      await mockDirHandle.getFileHandle('chunks_data.bin', { create: true });
      await mockDirHandle.getFileHandle('chunks_index.jsonl', { create: true });

      await store.init(mockDirHandle);

      // Old files should be deleted
      await expect(mockDirHandle.getFileHandle('chunks_data.bin')).rejects.toThrow(
        'File not found',
      );
      await expect(mockDirHandle.getFileHandle('chunks_index.jsonl')).rejects.toThrow(
        'File not found',
      );

      // IDB should be cleared during migration
      expect(clearDatabase).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('writeChunk', () => {
    it('should store chunk in IDB', async () => {
      await store.init(mockDirHandle);
      const data = new Uint8Array([1, 2, 3]);

      await store.writeChunk(0, data);

      expect(putChunk).toHaveBeenCalledWith(mockDb, 0, data);
    });

    it('should add entry to RAM index', async () => {
      await store.init(mockDirHandle);

      await store.writeChunk(0, new Uint8Array([1]));
      await store.writeChunk(5, new Uint8Array([2]));

      expect(store.getExistingIndices()).toEqual(new Set([0, 5]));
    });

    it('should auto-flush when IDB count reaches FLUSH_THRESHOLD', async () => {
      await store.init(mockDirHandle);

      // Mock a small set of keys but the threshold check sees >= 2000
      // We don't need to actually flush 2000 keys — just verify the flush triggers
      const keys = [0, 1, 2];
      let keysCallCount = 0;
      vi.mocked(getAllKeys).mockImplementation(async () => {
        keysCallCount++;
        // Call 1: writeChunk threshold check — return 2000 fake key lengths to trigger flush
        // We only return the actual 3 keys, but override the threshold check by returning
        // an array of length 2000
        if (keysCallCount === 1) return Array.from({ length: 2000 }, (_, i) => i);
        // Call 2: flushToDisk snapshot — return 3 actual keys to iterate
        if (keysCallCount === 2) return keys;
        // Call 3+: post-flush check — empty
        return [];
      });
      vi.mocked(getChunk).mockImplementation(async (_db, key) => new Uint8Array([key]));
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key]) })),
      );

      await store.writeChunk(0, new Uint8Array([0]));

      // Verify numbered files were created (flush triggered)
      expect(mockFs.files.has('chunks_data_0.bin')).toBe(true);
      expect(mockFs.files.has('chunks_index_0.jsonl')).toBe(true);

      // Verify deleteKeys was called with the snapshot keys
      expect(deleteKeys).toHaveBeenCalledWith(mockDb, expect.arrayContaining(keys));
    });
  });

  describe('flushToDisk', () => {
    it('should fetch all chunks in a single getChunksByKeys call during flush (not getAllChunks)', async () => {
      await store.init(mockDirHandle);

      // Clear getAllChunks call history from init (parseExistingIndex calls it)
      vi.mocked(getAllChunks).mockClear();

      const keys = [0, 1, 2];
      vi.mocked(getAllKeys).mockResolvedValue(keys);
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key * 10]) })),
      );
      vi.mocked(getChunk).mockImplementation(async (_db, key) => new Uint8Array([key * 10]));

      // Write 3 chunks (below threshold, so flush won't auto-trigger)
      // getAllKeys returns 3 which is < 2000, so no auto-flush
      for (const k of keys) {
        await store.writeChunk(k, new Uint8Array([k * 10]));
      }

      // Manually flush by calling prepareForRead
      await store.prepareForRead();

      // Verify getChunksByKeys was called for batch retrieval
      expect(getChunksByKeys).toHaveBeenCalled();

      // Verify getAllChunks was NOT called during flush — only getAllKeys + getChunksByKeys
      expect(getAllChunks).not.toHaveBeenCalled();
    });

    it('should write correct JSONL index entries', async () => {
      await store.init(mockDirHandle);

      const keys = [0, 1];
      vi.mocked(getAllKeys).mockResolvedValue(keys);
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, k) =>
        k.map((key) => ({
          key,
          data:
            key === 0 ? new Uint8Array([1, 2, 3]) : key === 1 ? new Uint8Array([4, 5]) : undefined,
        })),
      );
      vi.mocked(getChunk).mockImplementation(async (_db, key) => {
        if (key === 0) return new Uint8Array([1, 2, 3]);
        if (key === 1) return new Uint8Array([4, 5]);
        return undefined;
      });

      for (const k of keys) {
        await store.writeChunk(k, new Uint8Array([1])); // data doesn't matter, mocked
      }

      await store.prepareForRead();

      // Read the index file
      const indexHandle = await mockDirHandle.getFileHandle('chunks_index_0.jsonl');
      const indexFile = await indexHandle.getFile();
      const indexText = await indexFile.text();

      const lines = indexText.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry0 = JSON.parse(lines[0]);
      expect(entry0).toHaveProperty('i', 0);
      expect(entry0).toHaveProperty('o', 0);
      expect(entry0).toHaveProperty('l', 3); // [1,2,3] = 3 bytes

      const entry1 = JSON.parse(lines[1]);
      expect(entry1).toHaveProperty('i', 1);
      expect(entry1).toHaveProperty('o', 3);
      expect(entry1).toHaveProperty('l', 2); // [4,5] = 2 bytes
    });

    it('should increment file counter for subsequent flushes', async () => {
      await store.init(mockDirHandle);

      // Track which phase we're in for getAllKeys mocking
      // Phase 1: first write + flush | Phase 2: second write + flush
      let phase = 1;

      vi.mocked(getAllKeys).mockImplementation(async () => {
        if (phase === 1) return [0]; // 1 key for first flush
        return [1]; // 1 key for second flush
      });
      vi.mocked(getChunk).mockImplementation(async (_db, key) => new Uint8Array([key]));
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key]) })),
      );

      await store.writeChunk(0, new Uint8Array([0]));
      await store.prepareForRead();

      expect(mockFs.files.has('chunks_data_0.bin')).toBe(true);
      expect(mockFs.files.has('chunks_index_0.jsonl')).toBe(true);

      // Switch to phase 2
      phase = 2;

      await store.writeChunk(1, new Uint8Array([1]));
      await store.prepareForRead();

      expect(mockFs.files.has('chunks_data_1.bin')).toBe(true);
      expect(mockFs.files.has('chunks_index_1.jsonl')).toBe(true);
    });
  });

  describe('prepareForRead', () => {
    it('should flush remaining IDB chunks to disk', async () => {
      await store.init(mockDirHandle);

      vi.mocked(getAllKeys).mockResolvedValue([0, 1]);
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key]) })),
      );
      vi.mocked(getChunk).mockImplementation(async (_db, key) => new Uint8Array([key]));

      await store.writeChunk(0, new Uint8Array([0]));
      await store.writeChunk(1, new Uint8Array([1]));

      await store.prepareForRead();

      // After prepareForRead, all data should be on disk
      expect(mockFs.files.has('chunks_data_0.bin')).toBe(true);
    });
  });

  describe('readChunk', () => {
    it('should read chunk from disk after flush', async () => {
      await store.init(mockDirHandle);

      vi.mocked(getAllKeys).mockResolvedValue([0]);
      vi.mocked(getChunk).mockResolvedValue(new Uint8Array([10, 20, 30]));
      vi.mocked(getChunksByKeys).mockResolvedValue([
        { key: 0, data: new Uint8Array([10, 20, 30]) },
      ]);

      await store.writeChunk(0, new Uint8Array([10, 20, 30]));
      await store.prepareForRead();

      const result = await store.readChunk(0);
      expect(result).toEqual(new Uint8Array([10, 20, 30]));
    });

    it('should read chunk from IDB directly when not flushed', async () => {
      await store.init(mockDirHandle);

      vi.mocked(getChunk).mockResolvedValue(new Uint8Array([5, 6, 7]));

      await store.writeChunk(0, new Uint8Array([5, 6, 7]));

      // Don't call prepareForRead — chunk should still be readable from IDB
      const result = await store.readChunk(0);
      expect(result).toEqual(new Uint8Array([5, 6, 7]));
    });

    it('should throw if chunk index not found', async () => {
      await store.init(mockDirHandle);

      await expect(store.readChunk(999)).rejects.toThrow('Chunk 999 not found');
    });
  });

  describe('getExistingIndices', () => {
    it('should return all indices from RAM index', async () => {
      await store.init(mockDirHandle);

      await store.writeChunk(0, new Uint8Array([1]));
      await store.writeChunk(5, new Uint8Array([2]));
      await store.writeChunk(10, new Uint8Array([3]));

      expect(store.getExistingIndices()).toEqual(new Set([0, 5, 10]));
    });

    it('should stay synchronous', () => {
      // getExistingIndices should not return a Promise
      const result = store.getExistingIndices();
      expect(result).toBeInstanceOf(Set);
      expect(result).not.toBeInstanceOf(Promise);
    });
  });

  describe('clearDatabase', () => {
    it('should call through to ChunkIDB.clearDatabase', async () => {
      await store.init(mockDirHandle);

      await store.clearDatabase();

      expect(clearDatabase).toHaveBeenCalledWith(mockDb);
    });

    it('should clear RAM index', async () => {
      await store.init(mockDirHandle);
      await store.writeChunk(0, new Uint8Array([1]));

      await store.clearDatabase();

      expect(store.getExistingIndices()).toEqual(new Set());
    });
  });

  describe('close', () => {
    it('should close IDB connection', async () => {
      await store.init(mockDirHandle);
      await store.close();

      expect(closeDatabase).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('concurrent writes during flush', () => {
    it('should handle chunks arriving during active flush', async () => {
      await store.init(mockDirHandle);

      let resolveFirstFlush: () => void;
      const firstFlushBlocker = new Promise<void>((resolve) => {
        resolveFirstFlush = resolve;
      });

      let keysCallIndex = 0;
      vi.mocked(getAllKeys).mockImplementation(async () => {
        keysCallIndex++;
        // Call 1: writeChunk(0) threshold check — return [] (no flush)
        if (keysCallIndex === 1) return [];
        // Call 2: writeChunk(1) threshold check — return 2000 to trigger flush
        if (keysCallIndex === 2) return Array.from({ length: 2000 }, (_, i) => i);
        // Call 3: flushToDisk snapshot — return [0, 1] (just the keys we wrote)
        if (keysCallIndex === 3) return [0, 1];
        // Call 4+: post-flush recursion check — empty
        return [];
      });

      // getChunksByKeys blocks on first flush, resolves immediately after
      let getChunksByKeysCallCount = 0;
      vi.mocked(getChunksByKeys).mockImplementation(async (_db, keys) => {
        getChunksByKeysCallCount++;
        if (getChunksByKeysCallCount <= 1) {
          // Block during first flush for the two keys [0, 1]
          await firstFlushBlocker;
        }
        return keys.map((key) => ({ key, data: new Uint8Array([1]) }));
      });

      // getChunk blocks on first flush, resolves immediately after
      let getChunkCallCount = 0;
      vi.mocked(getChunk).mockImplementation(async () => {
        getChunkCallCount++;
        if (getChunkCallCount <= 2) {
          // Block during first flush for the two keys [0, 1]
          await firstFlushBlocker;
        }
        return new Uint8Array([1]);
      });

      // First write: no flush triggered
      await store.writeChunk(0, new Uint8Array([0]));

      // Second write triggers flush (getAllKeys returns 2000)
      // flushToDisk starts, calls getAllKeys again (call 3) → returns [0, 1]
      // Then calls getChunk(0) which blocks on firstFlushBlocker
      const writePromise1 = store.writeChunk(1, new Uint8Array([1]));

      // Write another chunk while flush is blocked — goes to IDB
      // getAllKeys call 4 returns [] (no additional flush)
      await store.writeChunk(2, new Uint8Array([2]));

      // Now release the flush
      resolveFirstFlush!();
      await writePromise1;

      // All chunks should be in the index
      expect(store.getExistingIndices()).toEqual(new Set([0, 1, 2]));
    });
  });

  describe('parseExistingIndex', () => {
    it('should load existing numbered index files on init', async () => {
      // Pre-create numbered index files
      const indexHandle0 = await mockDirHandle.getFileHandle('chunks_index_0.jsonl', {
        create: true,
      });
      const writable0 = await indexHandle0.createWritable();
      await writable0.write('{"i":0,"o":0,"l":3}\n{"i":1,"o":3,"l":2}\n');
      await writable0.close();

      // Pre-create corresponding data file
      const dataHandle0 = await mockDirHandle.getFileHandle('chunks_data_0.bin', { create: true });
      const dataWritable = await dataHandle0.createWritable();
      await dataWritable.write(new Uint8Array([1, 2, 3, 4, 5]));
      await dataWritable.close();

      // No IDB chunks
      vi.mocked(getAllChunks).mockResolvedValue([]);

      const newStore = new ChunkStore();
      await newStore.init(mockDirHandle);

      expect(newStore.getExistingIndices()).toEqual(new Set([0, 1]));
    });

    it('should load IDB entries on init', async () => {
      // No disk files, but IDB has chunks
      vi.mocked(getAllChunks).mockResolvedValue([
        { key: 10, data: new Uint8Array([1]) },
        { key: 20, data: new Uint8Array([2]) },
      ]);

      const newStore = new ChunkStore();
      await newStore.init(mockDirHandle);

      expect(newStore.getExistingIndices()).toEqual(new Set([10, 20]));
    });
  });
});
