import { describe, it, expect, beforeEach } from 'vitest';
import { checkResumeState } from './ResumeCheck';

// Mock File System Access API - similar to ChunkStore.test.ts
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
      entries: async function* () {
        for (const [name, _file] of files.entries()) {
          yield [name, { kind: 'file' as const }];
        }
      },
      removeEntry: async (name: string, _opts?: { recursive?: boolean }) => {
        files.delete(name);
      },
    };
  }

  createDirectoryWithFiles(fileEntries: Record<string, Uint8Array>) {
    for (const [name, data] of Object.entries(fileEntries)) {
      this.files.set(name, { data, name });
    }
    return this.createDirectoryHandle() as FileSystemDirectoryHandle;
  }
}

describe('ResumeCheck', () => {
  let mockFs: MockFileSystem;

  beforeEach(() => {
    mockFs = new MockFileSystem();
  });

  it('should return null for legacy chunk files without new format', async () => {
    // Mock directory with old-format files only
    const mockDir = mockFs.createDirectoryWithFiles({
      'chunk_000000.bin': new Uint8Array([1, 2, 3]),
      'chunk_000001.bin': new Uint8Array([4, 5, 6]),
      'pipeline_state.json': new TextEncoder().encode('{"assignments":[]}'),
    });

    // Create parent directory with _temp_work subdirectory
    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;

    // We need to mock getDirectoryHandle to return our mockDir
    const logMessages: string[] = [];
    const _originalGetDirectoryHandle = parentDir.getDirectoryHandle;
    parentDir.getDirectoryHandle = async (name: string) => {
      if (name === '_temp_work') {
        return mockDir;
      }
      throw new Error('Directory not found');
    };

    const result = await checkResumeState(parentDir, (msg) => logMessages.push(msg));
    // Should return null because chunks_index.jsonl doesn't exist (legacy wipe)
    expect(result).toBeNull();
    expect(logMessages.some(msg => msg.includes('legacy format detected'))).toBe(true);
  });

  it('should detect new format with chunks_index.jsonl', async () => {
    const mockDir = mockFs.createDirectoryWithFiles({
      'chunks_data.bin': new Uint8Array([1, 2, 3, 4, 5]),
      'chunks_index.jsonl': new TextEncoder().encode('{"i":0,"o":0,"l":5}\n'),
      'pipeline_state.json': new TextEncoder().encode('{"assignments":[]}'),
    });

    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    parentDir.getDirectoryHandle = async (name: string) => {
      if (name === '_temp_work') {
        return mockDir;
      }
      throw new Error('Directory not found');
    };

    const result = await checkResumeState(parentDir);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(1);
    expect(result!.hasLLMState).toBe(true);
  });

  it('should return null when no _temp_work directory exists', async () => {
    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    // Don't add any _temp_work

    const result = await checkResumeState(parentDir);
    expect(result).toBeNull();
  });

  it('should return null when no pipeline_state.json exists', async () => {
    const mockDir = mockFs.createDirectoryWithFiles({
      'chunks_index.jsonl': new TextEncoder().encode('{"i":0,"o":0,"l":5}\n'),
    });

    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    parentDir.getDirectoryHandle = async (name: string) => {
      if (name === '_temp_work') {
        return mockDir;
      }
      throw new Error('Directory not found');
    };

    const result = await checkResumeState(parentDir);
    expect(result).toBeNull();
  });

  it('should count multiple chunks from index file', async () => {
    const mockDir = mockFs.createDirectoryWithFiles({
      'chunks_data.bin': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      'chunks_index.jsonl': new TextEncoder().encode(
        '{"i":0,"o":0,"l":3}\n{"i":1,"o":3,"l":3}\n{"i":2,"o":6,"l":3}\n',
      ),
      'pipeline_state.json': new TextEncoder().encode('{"assignments":[]}'),
    });

    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    parentDir.getDirectoryHandle = async (name: string) => {
      if (name === '_temp_work') {
        return mockDir;
      }
      throw new Error('Directory not found');
    };

    const result = await checkResumeState(parentDir);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(3);
  });

  it('should handle empty index file', async () => {
    const mockDir = mockFs.createDirectoryWithFiles({
      'chunks_data.bin': new Uint8Array([]),
      'chunks_index.jsonl': new TextEncoder().encode(''),
      'pipeline_state.json': new TextEncoder().encode('{"assignments":[]}'),
    });

    const parentFs = new MockFileSystem();
    const parentDir = parentFs.createDirectoryHandle() as FileSystemDirectoryHandle;
    parentDir.getDirectoryHandle = async (name: string) => {
      if (name === '_temp_work') {
        return mockDir;
      }
      throw new Error('Directory not found');
    };

    const result = await checkResumeState(parentDir);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(0);
  });
});
