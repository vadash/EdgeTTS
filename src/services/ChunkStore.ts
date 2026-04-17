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

const FLUSH_THRESHOLD = 2000;

export class ChunkStore {
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private ramIndex = new Map<number, { file: string; offset: number; length: number }>();
  private fileCache = new Map<string, File>();
  private fileCounter = 0;
  private flushing = false;
  private db: IDBDatabase | null = null;

  async init(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
    this.directoryHandle = directoryHandle;
    this.db = await openDatabase();
    await this.migrateOldFormat();
    await this.parseExistingIndex();
  }

  /**
   * If old-format files (chunks_data.bin, chunks_index.jsonl) exist,
   * delete them along with any crswap files and numbered chunk files,
   * then clear IDB. Preserve pipeline_state.json and failed_chunks.json.
   */
  private async migrateOldFormat(): Promise<void> {
    let hasOldFormat = false;
    const toDelete: string[] = [];

    for await (const entry of this.directoryHandle!.values()) {
      if (entry.kind !== 'file') continue;
      const name = entry.name;

      if (name === 'chunks_data.bin' || name === 'chunks_index.jsonl') {
        hasOldFormat = true;
      }

      // Collect old-format files, crswap files, and any numbered chunk files
      if (
        name === 'chunks_data.bin' ||
        name === 'chunks_index.jsonl' ||
        (name.startsWith('chunks_data.bin') && name.endsWith('.crswap')) ||
        (name.startsWith('chunks_index.jsonl') && name.endsWith('.crswap')) ||
        /^chunks_data_\d+\.bin$/.test(name) ||
        /^chunks_index_\d+\.jsonl$/.test(name)
      ) {
        toDelete.push(name);
      }
    }

    if (hasOldFormat) {
      for (const name of toDelete) {
        try {
          await this.directoryHandle!.removeEntry(name);
        } catch {
          // Ignore errors
        }
      }
      if (this.db) {
        await clearDatabase(this.db);
      }
    }
  }

  /**
   * Scan directory for numbered index files and IDB contents to rebuild RAM index.
   */
  private async parseExistingIndex(): Promise<void> {
    let maxFileIndex = -1;

    for await (const entry of this.directoryHandle!.values()) {
      if (entry.kind !== 'file') continue;
      const match = entry.name.match(/^chunks_index_(\d+)\.jsonl$/);
      if (match) {
        const fileIndex = parseInt(match[1], 10);
        if (fileIndex > maxFileIndex) {
          maxFileIndex = fileIndex;
        }

        // Parse the index file
        const fileHandle = await this.directoryHandle!.getFileHandle(entry.name);
        const file = await fileHandle.getFile();
        const text = await file.text();
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try {
            const parsed = JSON.parse(line);
            if (
              typeof parsed.i === 'number' &&
              typeof parsed.o === 'number' &&
              typeof parsed.l === 'number'
            ) {
              this.ramIndex.set(parsed.i, {
                file: `chunks_data_${fileIndex}.bin`,
                offset: parsed.o,
                length: parsed.l,
              });
            }
          } catch {
            break;
          }
        }
      }
    }

    this.fileCounter = maxFileIndex + 1;

    // Also load IDB entries
    if (this.db) {
      const idbChunks = await getAllChunks(this.db);
      for (const { key, data } of idbChunks) {
        this.ramIndex.set(key, { file: 'idb', offset: 0, length: data.byteLength });
      }
    }
  }

  async writeChunk(index: number, data: Uint8Array): Promise<void> {
    if (!this.db) throw new Error('ChunkStore not initialized');

    await putChunk(this.db, index, data);
    this.ramIndex.set(index, { file: 'idb', offset: 0, length: data.byteLength });

    // Check if we should auto-flush
    const keys = await getAllKeys(this.db);
    if (keys.length >= FLUSH_THRESHOLD && !this.flushing) {
      await this.flushToDisk();
    }
  }

  /**
   * Flush IDB chunks to numbered disk files.
   * Streams one chunk at a time via getChunk() to keep RAM flat.
   */
  private async flushToDisk(): Promise<void> {
    this.flushing = true;

    try {
      const keys = await getAllKeys(this.db!);

      if (keys.length === 0) {
        return;
      }

      const dataFileName = `chunks_data_${this.fileCounter}.bin`;
      const indexFileName = `chunks_index_${this.fileCounter}.jsonl`;

      const dataHandle = await this.directoryHandle!.getFileHandle(dataFileName, { create: true });
      const indexHandle = await this.directoryHandle!.getFileHandle(indexFileName, {
        create: true,
      });

      const dataStream = await dataHandle.createWritable({ keepExistingData: false });
      const indexStream = await indexHandle.createWritable({ keepExistingData: false });

      let byteOffset = 0;
      const flushedKeys: number[] = [];

      // Fetch all chunks in a single IDB transaction instead of one per key
      const chunks = await getChunksByKeys(this.db!, keys);

      for (const { key, data: chunkData } of chunks) {
        if (!chunkData) continue;

        // Ensure we have a regular ArrayBuffer (not SharedArrayBuffer) for File System Access API
        const buffer = new ArrayBuffer(chunkData.byteLength);
        new Uint8Array(buffer).set(chunkData);
        await dataStream.write(new Uint8Array(buffer));

        const indexEntry = { i: key, o: byteOffset, l: chunkData.byteLength };
        const indexLine = `${JSON.stringify(indexEntry)}\n`;
        await indexStream.write(indexLine);

        // Update RAM index to point to disk file
        this.ramIndex.set(key, {
          file: dataFileName,
          offset: byteOffset,
          length: chunkData.byteLength,
        });

        byteOffset += chunkData.byteLength;
        flushedKeys.push(key);
      }

      await dataStream.close();
      await indexStream.close();

      // Delete flushed keys from IDB
      await deleteKeys(this.db!, flushedKeys);

      this.fileCounter++;

      // Recurse if more chunks accumulated during flush
      const remaining = await getAllKeys(this.db!);
      if (remaining.length >= FLUSH_THRESHOLD) {
        await this.flushToDisk();
      }
    } finally {
      this.flushing = false;
    }
  }

  async prepareForRead(): Promise<void> {
    // Flush any remaining IDB chunks to disk
    await this.flushToDisk();

    // Cache File objects for all unique data files in RAM index
    const uniqueFiles = new Set<string>();
    for (const entry of this.ramIndex.values()) {
      if (entry.file !== 'idb') {
        uniqueFiles.add(entry.file);
      }
    }

    for (const fileName of uniqueFiles) {
      const fileHandle = await this.directoryHandle!.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      this.fileCache.set(fileName, file);
    }
  }

  async readChunk(index: number): Promise<Uint8Array> {
    const entry = this.ramIndex.get(index);
    if (!entry) {
      throw new Error(`Chunk ${index} not found`);
    }

    if (entry.file === 'idb') {
      const data = await getChunk(this.db!, index);
      if (!data) throw new Error(`Chunk ${index} not found in IDB`);
      return data;
    }

    const file = this.fileCache.get(entry.file);
    if (!file) {
      throw new Error(`File ${entry.file} not cached. Call prepareForRead() first.`);
    }

    const blob = file.slice(entry.offset, entry.offset + entry.length);
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  getExistingIndices(): Set<number> {
    return new Set(this.ramIndex.keys());
  }

  async clearDatabase(): Promise<void> {
    if (this.db) {
      await clearDatabase(this.db);
    }
    this.ramIndex.clear();
  }

  async close(): Promise<void> {
    if (this.db) {
      await closeDatabase(this.db);
      this.db = null;
    }
    this.fileCache.clear();
    this.directoryHandle = null;
  }
}
