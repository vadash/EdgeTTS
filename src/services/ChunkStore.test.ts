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
          createWritable: async (_opts?: { keepExistingData?: boolean }) => {
            let position = 0;
            return {
              write: async (data: Uint8Array | string) => {
                const bytes = typeof data === 'string'
                  ? new TextEncoder().encode(data)
                  : data;
                const currentData = file.data;
                const before = currentData.slice(0, position);
                const after = currentData.slice(position + bytes.length);
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
});
