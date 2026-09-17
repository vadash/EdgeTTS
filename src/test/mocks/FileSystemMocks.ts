interface SharedMockState {
  files: Map<string, Uint8Array>;
  subdirs: Map<string, FileSystemDirectoryHandle>;
}

/** Blob-like view over bytes; slice() returns a narrowed view like a real Blob. */
function mockBlob(name: string, data: Uint8Array): File {
  return {
    name,
    type: 'application/octet-stream',
    size: data.length,
    lastModified: Date.now(),
    webkitRelativePath: '',
    bytes: async () => data,
    arrayBuffer: async () =>
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    text: async () => new TextDecoder().decode(data),
    slice: (start?: number, end?: number) =>
      mockBlob(name, data.slice(start ?? 0, end ?? data.length)) as unknown as File,
    stream: () => new ReadableStream(),
  } as unknown as File;
}

function createMockFile(name: string, files: Map<string, Uint8Array>): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    isSameEntry: async () => false,
    getFile: async () => mockBlob(name, files.get(name) ?? new Uint8Array([])),
    createWritable: async () => {
      const chunks: Uint8Array[] = [];
      return {
        write: async (data: BufferSource | Blob | string) => {
          if (typeof data === 'string') {
            chunks.push(new TextEncoder().encode(data));
          } else if (data instanceof Uint8Array) {
            chunks.push(data);
          } else if (data instanceof ArrayBuffer) {
            chunks.push(new Uint8Array(data));
          } else if (data instanceof Blob) {
            const buffer = await data.arrayBuffer();
            chunks.push(new Uint8Array(buffer));
          }
        },
        close: async () => {
          const combined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          files.set(name, combined);
        },
        seek: async () => {},
        truncate: async () => {},
        abort: async () => {},
        locked: false,
        getWriter: () =>
          ({
            write: async () => {},
            close: async () => {},
            abort: async () => {},
            closed: Promise.resolve(),
            desiredSize: 0,
            ready: Promise.resolve(),
            releaseLock: () => {},
          }) as unknown as WritableStreamDefaultWriter<unknown>,
      } as unknown as FileSystemWritableFileStream;
    },
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
  } as FileSystemFileHandle;
}

function createMockDirectoryHandleWithState(
  state: SharedMockState,
  name: string = 'test-dir',
): FileSystemDirectoryHandle {
  const { files, subdirs } = state;

  return {
    kind: 'directory',
    name,
    isSameEntry: async () => false,
    getDirectoryHandle: async (subdirName: string, options?: { create?: boolean }) => {
      if (subdirs.has(subdirName)) {
        return subdirs.get(subdirName)!;
      }
      if (!options?.create) {
        throw new DOMException('Directory not found', 'NotFoundError');
      }
      const newDir = createMockDirectoryHandleWithState(
        { files: new Map(), subdirs: new Map() },
        subdirName,
      );
      subdirs.set(subdirName, newDir);
      return newDir;
    },
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (!files.has(fileName) && !options?.create) {
        throw new DOMException('File not found', 'NotFoundError');
      }
      if (!files.has(fileName) && options?.create) {
        files.set(fileName, new Uint8Array([]));
      }
      return createMockFile(fileName, files);
    },
    removeEntry: async (name: string, _options?: { recursive?: boolean }) => {
      if (!files.has(name) && !subdirs.has(name)) {
        throw new DOMException('Entry not found', 'NotFoundError');
      }
      files.delete(name);
      subdirs.delete(name);
    },
    resolve: async () => null,
    keys: async function* () {
      yield* files.keys();
      yield* subdirs.keys();
    },
    values: async function* () {
      for (const [fname] of files) {
        yield createMockFile(fname, files);
      }
      for (const [, handle] of subdirs) {
        yield handle;
      }
    },
    entries: async function* () {
      for (const fname of files.keys()) {
        yield [fname, createMockFile(fname, files)] as [string, FileSystemHandle];
      }
      for (const [sname, handle] of subdirs) {
        yield [sname, handle] as [string, FileSystemHandle];
      }
    },
    [Symbol.asyncIterator]: async function* () {
      for (const fname of files.keys()) {
        yield [fname, createMockFile(fname, files)] as [string, FileSystemHandle];
      }
      for (const [sname, handle] of subdirs) {
        yield [sname, handle] as [string, FileSystemHandle];
      }
    },
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
  } as FileSystemDirectoryHandle;
}

/**
 * Create a mock FileSystemDirectoryHandle that supports nested directories with shared state
 */
export function createMockDirectoryHandle(): FileSystemDirectoryHandle {
  const state: SharedMockState = {
    files: new Map<string, Uint8Array>(),
    subdirs: new Map<string, FileSystemDirectoryHandle>(),
  };
  return createMockDirectoryHandleWithState(state);
}
