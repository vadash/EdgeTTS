// ChunkIDB.ts - IndexedDB access layer for hybrid chunk storage
// Provides low-level operations for the edgetts_hybrid_chunks database

import { openIDB, requestToPromise, withTransaction } from '@/utils/idb';

const DB_NAME = 'edgetts_hybrid_chunks';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

/**
 * Opens or creates the IndexedDB database for chunk storage.
 * Creates the 'chunks' object store on upgrade needed.
 *
 * @returns Promise<IDBDatabase> - The opened database connection
 * @throws Error if database open fails
 */
export async function openDatabase(): Promise<IDBDatabase> {
  return openIDB(DB_NAME, DB_VERSION, (db) => {
    // Create object store without keyPath (out-of-line keys)
    // Keys are passed as the second argument to put()
    db.createObjectStore(STORE_NAME);
  });
}

/**
 * Stores a single chunk with its numeric key in the database.
 *
 * @param db - The IndexedDB database connection
 * @param index - The numeric key for the chunk
 * @param data - The Uint8Array data to store
 * @throws Error if the put operation fails
 */
export async function putChunk(db: IDBDatabase, index: number, data: Uint8Array): Promise<void> {
  await withTransaction(db, STORE_NAME, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME).put(data, index);
  });
}

/**
 * Retrieves all chunks from the database with their keys.
 * Returns an array of objects with key and data properties.
 *
 * @param db - The IndexedDB database connection
 * @returns Promise<Array<{key: number, data: Uint8Array}>> - All stored chunks
 * @throws Error if the retrieval fails
 */
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

/**
 * Retrieves all keys from the database without fetching payload data.
 * This is a lightweight operation used to snapshot current state.
 *
 * @param db - The IndexedDB database connection
 * @returns Promise<number[]> - Array of all chunk keys
 * @throws Error if the retrieval fails
 */
export async function getAllKeys(db: IDBDatabase): Promise<number[]> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return requestToPromise<number[]>(store.getAllKeys());
}

/**
 * Retrieves multiple chunks by their keys in a single readonly transaction.
 * Avoids the overhead of opening a separate transaction per key.
 *
 * @param db - The IndexedDB database connection
 * @param keys - Array of numeric keys to retrieve
 * @returns Promise<Array<{ key: number; data: Uint8Array | undefined }>>
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
 * Retrieves a single chunk by its key.
 * Used during flush to stream one chunk at a time.
 *
 * @param db - The IndexedDB database connection
 * @param key - The numeric key of the chunk to retrieve
 * @returns Promise<Uint8Array | undefined> - The chunk data, or undefined if not found
 * @throws Error if the retrieval fails
 */
export async function getChunk(db: IDBDatabase, key: number): Promise<Uint8Array | undefined> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return requestToPromise<Uint8Array | undefined>(store.get(key));
}

/**
 * Deletes multiple chunks by their keys in a single transaction.
 *
 * @param db - The IndexedDB database connection
 * @param keys - Array of numeric keys to delete
 * @throws Error if the delete operation fails
 */
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

/**
 * Clears all entries from the chunks store.
 *
 * @param db - The IndexedDB database connection
 * @throws Error if the clear operation fails
 */
export async function clearDatabase(db: IDBDatabase): Promise<void> {
  await withTransaction(db, STORE_NAME, 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME).clear();
  });
}

/**
 * Closes the IndexedDB database connection.
 *
 * @param db - The IndexedDB database connection
 */
export async function closeDatabase(db: IDBDatabase): Promise<void> {
  db.close();
}
