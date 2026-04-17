import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChunkStore } from '../ChunkStore';

// Mock ChunkIDB module
vi.mock('../ChunkIDB', () => ({
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
} from '../ChunkIDB';

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

function createMockDirectory(): FileSystemDirectoryHandle {
  const mockFs = new MockFileSystem();
  return mockFs.createDirectoryHandle() as FileSystemDirectoryHandle;
}

describe('ChunkStore Integration', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should handle full write-then-read cycle with out-of-order writes', async () => {
    const mockDir = createMockDirectory();

    // Track what's stored in "IDB"
    const idbStore = new Map<number, Uint8Array>();

    vi.mocked(putChunk).mockImplementation(async (_db, index, data) => {
      idbStore.set(index, data);
    });
    vi.mocked(getAllKeys).mockImplementation(async () => Array.from(idbStore.keys()));
    vi.mocked(getChunk).mockImplementation(async (_db, key) => idbStore.get(key));
    vi.mocked(getChunksByKeys).mockImplementation(async (_db, keys) =>
      keys.map((key) => ({ key, data: idbStore.get(key) })),
    );
    vi.mocked(deleteKeys).mockImplementation(async (_db, keys) => {
      for (const k of keys) idbStore.delete(k);
    });

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
    expect(await store.readChunk(0)).toEqual(new Uint8Array([0, 0, 0]));
    expect(await store.readChunk(2)).toEqual(new Uint8Array([2, 2, 2]));
    expect(await store.readChunk(5)).toEqual(new Uint8Array([5, 5, 5]));
    expect(await store.readChunk(7)).toEqual(new Uint8Array([7, 7, 7]));
    expect(await store.readChunk(10)).toEqual(new Uint8Array([10, 10, 10]));
  });

  it('should resume from existing state', async () => {
    const mockDir = createMockDirectory();

    // Track what's stored in "IDB" — persists across store instances
    const idbStore = new Map<number, Uint8Array>();

    vi.mocked(putChunk).mockImplementation(async (_db, index, data) => {
      idbStore.set(index, data);
    });
    vi.mocked(getAllChunks).mockImplementation(async () =>
      Array.from(idbStore.entries()).map(([key, data]) => ({ key, data })),
    );
    vi.mocked(getAllKeys).mockImplementation(async () => Array.from(idbStore.keys()));
    vi.mocked(getChunk).mockImplementation(async (_db, key) => idbStore.get(key));
    vi.mocked(getChunksByKeys).mockImplementation(async (_db, keys) =>
      keys.map((key) => ({ key, data: idbStore.get(key) })),
    );
    vi.mocked(deleteKeys).mockImplementation(async (_db, keys) => {
      for (const k of keys) idbStore.delete(k);
    });

    // First session: write some chunks, then prepareForRead to flush to disk
    const store1 = new ChunkStore();
    await store1.init(mockDir);
    await store1.writeChunk(0, new Uint8Array([1, 2, 3]));
    await store1.writeChunk(1, new Uint8Array([4, 5, 6]));
    await store1.prepareForRead(); // flush to disk
    await store1.close();

    // Second session: resume and add more
    const store2 = new ChunkStore();
    await store2.init(mockDir);

    // Existing chunks from disk (parsed from numbered index files)
    expect(store2.getExistingIndices()).toEqual(new Set([0, 1]));

    await store2.writeChunk(2, new Uint8Array([7, 8, 9]));
    await store2.prepareForRead();

    expect(await store2.readChunk(0)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store2.readChunk(1)).toEqual(new Uint8Array([4, 5, 6]));
    expect(await store2.readChunk(2)).toEqual(new Uint8Array([7, 8, 9]));
  });
});
