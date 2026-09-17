import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { createMockChunkIdb, type MockChunkIdb } from '@/test/mocks/MockChunkIdb';

import { ChunkStore } from './ChunkStore';
import * as ChunkIDB from './ChunkIDB';

// Mock the ChunkIDB module so the default constructor adapter stays testable.
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

describe('ChunkStore', () => {
  let root: FileSystemDirectoryHandle;
  let idb: MockChunkIdb;
  let store: ChunkStore;

  beforeEach(() => {
    root = createMockDirectoryHandle();
    idb = createMockChunkIdb();
    store = new ChunkStore(idb);
  });

  async function seedWorkFolder(entries: Record<string, string | Uint8Array<ArrayBuffer>>) {
    const work = await root.getDirectoryHandle('_temp_work', { create: true });
    for (const [name, data] of Object.entries(entries)) {
      const handle = await work.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    }
    return work;
  }

  describe('work folder ownership', () => {
    it('peekWorkFolder returns null when _temp_work does not exist and never creates it', async () => {
      await expect(store.peekWorkFolder(root)).resolves.toBeNull();
      await expect(root.getDirectoryHandle('_temp_work')).rejects.toThrow();
    });

    it('peekWorkFolder returns the existing _temp_work handle', async () => {
      const created = await root.getDirectoryHandle('_temp_work', { create: true });
      await expect(store.peekWorkFolder(root)).resolves.toBe(created);
    });

    it('ensureWorkFolder creates _temp_work when missing and returns it afterwards', async () => {
      const folder = await store.ensureWorkFolder(root);
      expect(folder.name).toBe('_temp_work');
      await expect(store.peekWorkFolder(root)).resolves.toBe(folder);
    });

    it('wipe removes _temp_work recursively', async () => {
      await seedWorkFolder({ 'chunks_data_0.bin': new Uint8Array([1]) });
      await expect(store.wipe(root)).resolves.toBe(true);
      await expect(store.peekWorkFolder(root)).resolves.toBeNull();
    });

    it('wipe is a no-op when _temp_work does not exist', async () => {
      await expect(store.wipe(root)).resolves.toBe(false);
    });

    it('wipe never touches IDB (that is clearAll)', async () => {
      await seedWorkFolder({});
      idb.store.set(7, new Uint8Array([1]));
      await store.wipe(root);
      expect(idb.store.has(7)).toBe(true);
      expect(idb.clearDatabase).not.toHaveBeenCalled();
    });

    it('clearAll wipes the folder, clears IDB and the RAM index', async () => {
      await store.init(root);
      await store.writeChunk(3, new Uint8Array([9]));
      await store.clearAll(root);
      await expect(store.peekWorkFolder(root)).resolves.toBeNull();
      expect(idb.store.size).toBe(0);
      expect(store.getExistingIndices()).toEqual(new Set());
    });

    it('clearAll still clears IDB when _temp_work is missing (fresh start)', async () => {
      await store.init(root);
      await store.writeChunk(3, new Uint8Array([9]));
      await store.wipe(root);
      await store.clearAll(root);
      expect(idb.store.size).toBe(0);
    });
  });

  describe('snapshot', () => {
    it('counts JSONL index lines across numbered index files', async () => {
      await seedWorkFolder({
        'chunks_index_0.jsonl': '{"i":0,"o":0,"l":3}\n{"i":1,"o":3,"l":3}\n',
        'chunks_index_1.jsonl': '{"i":2,"o":0,"l":2}\n',
        'chunks_data_0.bin': new Uint8Array([1, 2, 3]),
      });
      const work = (await store.peekWorkFolder(root))!;
      await expect(store.snapshot(work)).resolves.toEqual({ chunkCount: 3, legacyOnly: false });
    });

    it('ignores blank lines in index files', async () => {
      await seedWorkFolder({ 'chunks_index_0.jsonl': '{"i":0,"o":0,"l":3}\n\n  \n' });
      const work = (await store.peekWorkFolder(root))!;
      expect((await store.snapshot(work)).chunkCount).toBe(1);
    });

    it('flags legacyOnly when only legacy chunk_*.bin files exist', async () => {
      await seedWorkFolder({
        'chunk_0001.bin': new Uint8Array([1]),
        'pipeline_state.json': '{}',
      });
      const work = (await store.peekWorkFolder(root))!;
      await expect(store.snapshot(work)).resolves.toEqual({ chunkCount: 0, legacyOnly: true });
    });

    it('is not legacyOnly when current-format index files coexist with legacy files', async () => {
      await seedWorkFolder({
        'chunk_0001.bin': new Uint8Array([1]),
        'chunks_index_0.jsonl': '{"i":0,"o":0,"l":3}\n',
      });
      const work = (await store.peekWorkFolder(root))!;
      await expect(store.snapshot(work)).resolves.toEqual({ chunkCount: 1, legacyOnly: false });
    });

    it('scans the folder without opening IDB', async () => {
      await seedWorkFolder({ 'chunks_index_0.jsonl': '{"i":0,"o":0,"l":3}\n' });
      const work = (await store.peekWorkFolder(root))!;
      await store.snapshot(work);
      expect(idb.openDatabase).not.toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('creates _temp_work itself and exposes it via workFolder()', async () => {
      await store.init(root);
      const work = store.workFolder();
      expect(work.name).toBe('_temp_work');
      await expect(root.getDirectoryHandle('_temp_work')).resolves.toBe(work);
    });

    it('opens IDB and ingests existing IDB chunks', async () => {
      idb.store.set(10, new Uint8Array([1]));
      idb.store.set(20, new Uint8Array([2]));
      await store.init(root);
      expect(store.getExistingIndices()).toEqual(new Set([10, 20]));
    });

    it('migrates old-format files inside _temp_work and clears IDB', async () => {
      const work = await seedWorkFolder({
        'chunks_data.bin': new Uint8Array([1]),
        'chunks_index.jsonl': new Uint8Array([1]),
      });
      await store.init(root);
      await expect(work.getFileHandle('chunks_data.bin')).rejects.toThrow();
      await expect(work.getFileHandle('chunks_index.jsonl')).rejects.toThrow();
      expect(idb.clearDatabase).toHaveBeenCalled();
    });

    it('workFolder() throws before init and after close', async () => {
      expect(() => store.workFolder()).toThrow('ChunkStore not initialized');
      await store.init(root);
      await store.close();
      expect(() => store.workFolder()).toThrow('ChunkStore not initialized');
    });

    it('defaults to the real ChunkIDB module as adapter', async () => {
      const fake = createMockChunkIdb();
      vi.mocked(ChunkIDB.openDatabase).mockImplementation(fake.openDatabase);
      vi.mocked(ChunkIDB.putChunk).mockImplementation(fake.putChunk);
      vi.mocked(ChunkIDB.getAllChunks).mockImplementation(fake.getAllChunks);
      vi.mocked(ChunkIDB.getAllKeys).mockImplementation(fake.getAllKeys);
      vi.mocked(ChunkIDB.getChunk).mockImplementation(fake.getChunk);
      vi.mocked(ChunkIDB.getChunksByKeys).mockImplementation(fake.getChunksByKeys);
      vi.mocked(ChunkIDB.deleteKeys).mockImplementation(fake.deleteKeys);
      vi.mocked(ChunkIDB.clearDatabase).mockImplementation(fake.clearDatabase);
      vi.mocked(ChunkIDB.closeDatabase).mockImplementation(fake.closeDatabase);

      const defaultStore = new ChunkStore();
      await defaultStore.init(root);
      await defaultStore.writeChunk(0, new Uint8Array([1, 2]));
      expect(fake.store.get(0)).toEqual(new Uint8Array([1, 2]));
      await defaultStore.close();
    });
  });

  describe('writeChunk', () => {
    it('should store chunk in IDB', async () => {
      await store.init(root);
      const data = new Uint8Array([1, 2, 3]);

      await store.writeChunk(0, data);

      expect(idb.store.get(0)).toEqual(data);
    });

    it('should add entry to RAM index', async () => {
      await store.init(root);

      await store.writeChunk(0, new Uint8Array([1]));
      await store.writeChunk(5, new Uint8Array([2]));

      expect(store.getExistingIndices()).toEqual(new Set([0, 5]));
    });

    it('should auto-flush when IDB count reaches FLUSH_THRESHOLD', async () => {
      const work = await store.ensureWorkFolder(root);
      await store.init(root);

      // Only 3 real keys, but the threshold check sees 2000 to trigger a flush.
      const keys = [0, 1, 2];
      let keysCallCount = 0;
      idb.getAllKeys.mockImplementation(async () => {
        keysCallCount++;
        if (keysCallCount === 1) return Array.from({ length: 2000 }, (_, i) => i);
        if (keysCallCount === 2) return keys;
        return [];
      });
      idb.getChunksByKeys.mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key]) })),
      );

      await store.writeChunk(0, new Uint8Array([0]));

      await expect(work.getFileHandle('chunks_data_0.bin')).resolves.toBeDefined();
      await expect(work.getFileHandle('chunks_index_0.jsonl')).resolves.toBeDefined();

      expect(idb.deleteKeys).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(keys));
    });
  });

  describe('flushToDisk', () => {
    it('should fetch all chunks in a single getChunksByKeys call during flush (not getAllChunks)', async () => {
      await store.init(root);

      // Clear getAllChunks call history from init (parseExistingIndex calls it)
      idb.getAllChunks.mockClear();

      const keys = [0, 1, 2];
      idb.getChunksByKeys.mockImplementation(async (_db, k) =>
        k.map((key) => ({ key, data: new Uint8Array([key * 10]) })),
      );

      for (const k of keys) {
        await store.writeChunk(k, new Uint8Array([k * 10]));
      }

      await store.prepareForRead();

      expect(idb.getChunksByKeys).toHaveBeenCalled();
      expect(idb.getAllChunks).not.toHaveBeenCalled();
    });

    it('should write correct JSONL index entries', async () => {
      const work = await store.ensureWorkFolder(root);
      await store.init(root);

      const keys = [0, 1];
      idb.getChunksByKeys.mockImplementation(async (_db, k) =>
        k.map((key) => ({
          key,
          data:
            key === 0 ? new Uint8Array([1, 2, 3]) : key === 1 ? new Uint8Array([4, 5]) : undefined,
        })),
      );

      // The written data is irrelevant because getChunksByKeys is mocked.
      for (const k of keys) {
        await store.writeChunk(k, new Uint8Array([1]));
      }

      await store.prepareForRead();

      const indexHandle = await work.getFileHandle('chunks_index_0.jsonl');
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
  });

  describe('prepareForRead', () => {
    it('should flush remaining IDB chunks to disk', async () => {
      const work = await store.ensureWorkFolder(root);
      await store.init(root);

      await store.writeChunk(0, new Uint8Array([0]));
      await store.writeChunk(1, new Uint8Array([1]));

      await store.prepareForRead();

      await expect(work.getFileHandle('chunks_data_0.bin')).resolves.toBeDefined();
    });
  });

  describe('readChunk', () => {
    it('should read chunk from disk after flush', async () => {
      await store.init(root);

      await store.writeChunk(0, new Uint8Array([10, 20, 30]));
      await store.prepareForRead();

      const result = await store.readChunk(0);
      expect(result).toEqual(new Uint8Array([10, 20, 30]));
    });

    it('should read chunk from IDB directly when not flushed', async () => {
      await store.init(root);

      await store.writeChunk(0, new Uint8Array([5, 6, 7]));

      // No prepareForRead call here, so the chunk must come from IDB.
      const result = await store.readChunk(0);
      expect(result).toEqual(new Uint8Array([5, 6, 7]));
    });

    it('should throw if chunk index not found', async () => {
      await store.init(root);

      await expect(store.readChunk(999)).rejects.toThrow('Chunk 999 not found');
    });
  });

  describe('getExistingIndices', () => {
    it('should return all indices from RAM index', async () => {
      await store.init(root);

      await store.writeChunk(0, new Uint8Array([1]));
      await store.writeChunk(5, new Uint8Array([2]));
      await store.writeChunk(10, new Uint8Array([3]));

      expect(store.getExistingIndices()).toEqual(new Set([0, 5, 10]));
    });
  });

  describe('close', () => {
    it('should close IDB connection', async () => {
      await store.init(root);
      await store.close();

      expect(idb.closeDatabase).toHaveBeenCalled();
    });
  });

  describe('write→read cycles', () => {
    it('should handle full write-then-read cycle with out-of-order writes', async () => {
      await store.init(root);

      // Simulate TTS workers completing out of order
      await Promise.all([
        store.writeChunk(5, new Uint8Array([5, 5, 5])),
        store.writeChunk(0, new Uint8Array([0, 0, 0])),
        store.writeChunk(10, new Uint8Array([10, 10, 10])),
        store.writeChunk(2, new Uint8Array([2, 2, 2])),
        store.writeChunk(7, new Uint8Array([7, 7, 7])),
      ]);
      await store.prepareForRead();

      // The audio merge reads chunks in chunk-index order.
      expect(await store.readChunk(0)).toEqual(new Uint8Array([0, 0, 0]));
      expect(await store.readChunk(2)).toEqual(new Uint8Array([2, 2, 2]));
      expect(await store.readChunk(5)).toEqual(new Uint8Array([5, 5, 5]));
      expect(await store.readChunk(7)).toEqual(new Uint8Array([7, 7, 7]));
      expect(await store.readChunk(10)).toEqual(new Uint8Array([10, 10, 10]));
    });

    it('should resume from existing state across sessions', async () => {
      // First session.
      const store1 = new ChunkStore(idb);
      await store1.init(root);
      await store1.writeChunk(0, new Uint8Array([1, 2, 3]));
      await store1.writeChunk(1, new Uint8Array([4, 5, 6]));
      await store1.prepareForRead();
      await store1.close();

      // Second session: same IDB, folder state parsed from disk
      const store2 = new ChunkStore(idb);
      await store2.init(root);

      // Existing chunks from disk (parsed from numbered index files)
      expect(store2.getExistingIndices()).toEqual(new Set([0, 1]));

      await store2.writeChunk(2, new Uint8Array([7, 8, 9]));
      await store2.prepareForRead();

      expect(await store2.readChunk(0)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await store2.readChunk(1)).toEqual(new Uint8Array([4, 5, 6]));
      expect(await store2.readChunk(2)).toEqual(new Uint8Array([7, 8, 9]));
    });
  });
});
