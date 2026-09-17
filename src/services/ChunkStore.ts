import { withPermissionRetry } from '@/utils/retry/filesystem';

import * as ChunkIDB from './ChunkIDB';
import type { ChunkIdbAdapter } from './ChunkIDB';

/** Chunks buffered in IDB before the next flush to disk. */
const FLUSH_THRESHOLD = 2000;

/** Numbered index file names: chunks_index_N.jsonl (capture = file index). */
const INDEX_FILE_RE = /^chunks_index_(\d+)\.jsonl$/;
/** Numbered data file names: chunks_data_N.bin. */
const DATA_FILE_RE = /^chunks_data_\d+\.bin$/;

function indexFileName(fileIndex: number): string {
  return `chunks_index_${fileIndex}.jsonl`;
}

function dataFileName(fileIndex: number): string {
  return `chunks_data_${fileIndex}.bin`;
}

/**
 * Chunk store for one Conversion. Chunks buffer in IDB and flush to
 * numbered data/index file pairs under `_temp_work`. The store owns the
 * folder lifecycle; the Failure log and pipeline state are tenants in
 * the folder.
 */
export class ChunkStore {
  private idb: ChunkIdbAdapter;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private ramIndex = new Map<number, { file: string; offset: number; length: number }>();
  private fileCache = new Map<string, File>();
  private fileCounter = 0;
  private flushing = false;
  private db: IDBDatabase | null = null;

  constructor(idb: ChunkIdbAdapter = ChunkIDB) {
    this.idb = idb;
  }

  /**
   * Post-init accessor for the `_temp_work` handle (FailureLog etc.).
   * Throws before init() and after close().
   */
  workFolder(): FileSystemDirectoryHandle {
    if (!this.directoryHandle) throw new Error('ChunkStore not initialized');
    return this.directoryHandle;
  }

  /**
   * Returns the existing `_temp_work` handle under root, or null.
   * Never creates the folder. Safe before init().
   */
  async peekWorkFolder(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await root.getDirectoryHandle('_temp_work');
    } catch {
      return null;
    }
  }

  /** Returns the `_temp_work` handle under root, creating the folder when missing. */
  async ensureWorkFolder(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
    return withPermissionRetry(root, () => root.getDirectoryHandle('_temp_work', { create: true }));
  }

  /**
   * Folder scan only; it never opens IDB, so it is safe before init().
   * chunkCount: number of chunks recorded in current-format JSONL index
   * files. legacyOnly: legacy chunk_*.bin files present and no
   * current-format index.
   */
  async snapshot(
    root: FileSystemDirectoryHandle,
  ): Promise<{ chunkCount: number; legacyOnly: boolean }> {
    let chunkCount = 0;
    let hasIndex = false;
    let hasLegacy = false;

    for await (const entry of root.values()) {
      if (entry.kind !== 'file') continue;
      if (INDEX_FILE_RE.test(entry.name)) {
        hasIndex = true;
        const handle = await root.getFileHandle(entry.name);
        const file = await handle.getFile();
        const text = await file.text();
        chunkCount += text.split('\n').filter((line) => line.trim().length > 0).length;
      } else if (entry.name.startsWith('chunk_') && entry.name.endsWith('.bin')) {
        hasLegacy = true;
      }
    }

    return { chunkCount, legacyOnly: hasLegacy && !hasIndex };
  }

  /**
   * Best-effort recursive removal of `_temp_work`. A missing folder is not
   * an error. Never touches IDB; clearAll() does that.
   * Returns true when removal succeeded, false when it was swallowed.
   */
  async wipe(root: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      await root.removeEntry('_temp_work', { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fresh start: wipe the work folder and clear the IDB chunk store.
   * The IDB clear runs even when the folder is already gone.
   */
  async clearAll(root: FileSystemDirectoryHandle): Promise<void> {
    await this.wipe(root);
    if (this.db) {
      await this.idb.clearDatabase(this.db);
    }
    this.ramIndex.clear();
  }

  /**
   * Creates `_temp_work` under root when missing, then opens IDB and
   * ingests any existing state (migration + index parse). Safe to call
   * again on an already-initialized store.
   */
  async init(root: FileSystemDirectoryHandle): Promise<void> {
    this.directoryHandle = await this.ensureWorkFolder(root);
    this.db = await this.idb.openDatabase();
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

      if (
        name === 'chunks_data.bin' ||
        name === 'chunks_index.jsonl' ||
        (name.startsWith('chunks_data.bin') && name.endsWith('.crswap')) ||
        (name.startsWith('chunks_index.jsonl') && name.endsWith('.crswap')) ||
        DATA_FILE_RE.test(name) ||
        INDEX_FILE_RE.test(name)
      ) {
        toDelete.push(name);
      }
    }

    if (hasOldFormat) {
      for (const name of toDelete) {
        try {
          await this.directoryHandle!.removeEntry(name);
        } catch {
          // Best-effort: one unremovable file must not abort the
          // migration.
        }
      }
      if (this.db) {
        await this.idb.clearDatabase(this.db);
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
      const match = entry.name.match(INDEX_FILE_RE);
      if (match) {
        const fileIndex = parseInt(match[1], 10);
        if (fileIndex > maxFileIndex) {
          maxFileIndex = fileIndex;
        }

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
                file: dataFileName(fileIndex),
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

    if (this.db) {
      const idbChunks = await this.idb.getAllChunks(this.db);
      for (const { key, data } of idbChunks) {
        this.ramIndex.set(key, { file: 'idb', offset: 0, length: data.byteLength });
      }
    }
  }

  async writeChunk(index: number, data: Uint8Array): Promise<void> {
    if (!this.db) throw new Error('ChunkStore not initialized');

    await this.idb.putChunk(this.db, index, data);
    this.ramIndex.set(index, { file: 'idb', offset: 0, length: data.byteLength });

    const keys = await this.idb.getAllKeys(this.db);
    if (keys.length >= FLUSH_THRESHOLD && !this.flushing) {
      await this.flushToDisk();
    }
  }

  /**
   * Flush IDB chunks to numbered data and index files.
   */
  private async flushToDisk(): Promise<void> {
    this.flushing = true;

    try {
      const keys = await this.idb.getAllKeys(this.db!);

      if (keys.length === 0) {
        return;
      }

      const dataName = dataFileName(this.fileCounter);
      const indexName = indexFileName(this.fileCounter);

      const dataHandle = await this.directoryHandle!.getFileHandle(dataName, { create: true });
      const indexHandle = await this.directoryHandle!.getFileHandle(indexName, {
        create: true,
      });

      const dataStream = await dataHandle.createWritable({ keepExistingData: false });
      const indexStream = await indexHandle.createWritable({ keepExistingData: false });

      let byteOffset = 0;
      const flushedKeys: number[] = [];

      // Fetch all chunks in a single IDB transaction instead of one per key
      const chunks = await this.idb.getChunksByKeys(this.db!, keys);

      for (const { key, data: chunkData } of chunks) {
        if (!chunkData) continue;

        // Ensure we have a regular ArrayBuffer (not SharedArrayBuffer) for File System Access API
        const buffer = new ArrayBuffer(chunkData.byteLength);
        new Uint8Array(buffer).set(chunkData);
        await dataStream.write(new Uint8Array(buffer));

        const indexEntry = { i: key, o: byteOffset, l: chunkData.byteLength };
        const indexLine = `${JSON.stringify(indexEntry)}\n`;
        await indexStream.write(indexLine);

        this.ramIndex.set(key, {
          file: dataName,
          offset: byteOffset,
          length: chunkData.byteLength,
        });

        byteOffset += chunkData.byteLength;
        flushedKeys.push(key);
      }

      await dataStream.close();
      await indexStream.close();

      await this.idb.deleteKeys(this.db!, flushedKeys);

      this.fileCounter++;

      // Chunks can accumulate while flushing, so re-check the threshold.
      const remaining = await this.idb.getAllKeys(this.db!);
      if (remaining.length >= FLUSH_THRESHOLD) {
        await this.flushToDisk();
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Flushes IDB chunks to disk and caches the File object of every data
   * file in the RAM index. readChunk() needs that cache for disk chunks.
   */
  async prepareForRead(): Promise<void> {
    await this.flushToDisk();

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
      const data = await this.idb.getChunk(this.db!, index);
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

  async close(): Promise<void> {
    if (this.db) {
      await this.idb.closeDatabase(this.db);
      this.db = null;
    }
    this.fileCache.clear();
    this.directoryHandle = null;
  }
}
