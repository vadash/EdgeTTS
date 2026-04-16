import { describe, it, expect } from 'vitest';
import { ChunkStore } from '../ChunkStore';

// Mock File System Access API (same as unit tests)
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
  it('should handle full write-then-read cycle with out-of-order writes', async () => {
    const mockDir = createMockDirectory();
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
