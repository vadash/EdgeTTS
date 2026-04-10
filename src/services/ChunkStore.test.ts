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
