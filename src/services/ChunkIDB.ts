import { openIDB, requestToPromise, withTransaction } from '@/utils/idb';

const DB_NAME = 'edgetts_hybrid_chunks';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

/**
 * The IDB operations ChunkStore depends on, as an injectable adapter.
 * The module's own exports satisfy this interface; tests substitute a
 * Map-backed fake (see src/test/mocks/MockChunkIdb.ts).
 */
export interface ChunkIdbAdapter {
  openDatabase(): Promise<IDBDatabase>;
  putChunk(db: IDBDatabase, index: number, data: Uint8Array): Promise<void>;
  getAllChunks(db: IDBDatabase): Promise<Array<{ key: number; data: Uint8Array }>>;
  getAllKeys(db: IDBDatabase): Promise<number[]>;
  getChunksByKeys(
    db: IDBDatabase,
    keys: number[],
  ): Promise<Array<{ key: number; data: Uint8Array | undefined }>>;
  getChunk(db: IDBDatabase, key: number): Promise<Uint8Array | undefined>;
  deleteKeys(db: IDBDatabase, keys: number[]): Promise<void>;
  clearDatabase(db: IDBDatabase): Promise<void>;
  closeDatabase(db: IDBDatabase): Promise<void>;
}

export async function openDatabase(): Promise<IDBDatabase> {
  return openIDB(DB_NAME, DB_VERSION, (db) => {
    // No keyPath: keys are out-of-line, so put() takes the Chunk index
    // as its second argument.
    db.createObjectStore(STORE_NAME);
  });
}

export async function putChunk(db: IDBDatabase, index: number, data: Uint8Array): Promise<void> {
  await withTransaction(db, STORE_NAME, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME).put(data, index);
  });
}

export async function getAllChunks(
  db: IDBDatabase,
): Promise<Array<{ key: number; data: Uint8Array }>> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  const [keys, data] = await Promise.all([
    requestToPromise<number[]>(store.getAllKeys()),
    requestToPromise<Uint8Array[]>(store.getAll()),
  ]);

  return keys.map((key, i) => ({ key, data: data[i] }));
}

export async function getAllKeys(db: IDBDatabase): Promise<number[]> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return requestToPromise<number[]>(store.getAllKeys());
}

/**
 * Retrieves multiple Chunks by key in one readonly transaction to avoid
 * the overhead of one transaction per key.
 */
export async function getChunksByKeys(
  db: IDBDatabase,
  keys: number[],
): Promise<Array<{ key: number; data: Uint8Array | undefined }>> {
  if (keys.length === 0) return [];

  return withTransaction(db, STORE_NAME, 'readonly', async (tx) => {
    const store = tx.objectStore(STORE_NAME);
    return Promise.all(
      keys.map(async (key) => ({
        key,
        data: await requestToPromise<Uint8Array | undefined>(store.get(key)),
      })),
    );
  });
}

/**
 * Retrieves one Chunk by key. The flush path reads one Chunk at a time to
 * stream it to disk.
 */
export async function getChunk(db: IDBDatabase, key: number): Promise<Uint8Array | undefined> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return requestToPromise<Uint8Array | undefined>(store.get(key));
}

export async function deleteKeys(db: IDBDatabase, keys: number[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await withTransaction(db, STORE_NAME, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) {
      store.delete(key);
    }
  });
}

export async function clearDatabase(db: IDBDatabase): Promise<void> {
  await withTransaction(db, STORE_NAME, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME).clear();
  });
}

export async function closeDatabase(db: IDBDatabase): Promise<void> {
  db.close();
}
