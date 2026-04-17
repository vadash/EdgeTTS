// ChunkIDB.ts - IndexedDB access layer for hybrid chunk storage
// Provides low-level operations for the edgetts_hybrid_chunks database

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
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Create object store without keyPath (out-of-line keys)
      // Keys are passed as the second argument to put()
      db.createObjectStore(STORE_NAME);
    };
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(data, index);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

  const keysPromise = new Promise<number[]>((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as number[]);
    request.onerror = () => reject(request.error);
  });

  const dataPromise = new Promise<Uint8Array[]>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as Uint8Array[]);
    request.onerror = () => reject(request.error);
  });

  const [keys, data] = await Promise.all([keysPromise, dataPromise]);

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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as number[]);
    request.onerror = () => reject(request.error);
  });
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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const results: Array<{ key: number; data: Uint8Array | undefined }> = [];

    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        results.push({ key, data: request.result as Uint8Array | undefined });
      };
      request.onerror = () => reject(request.error);
    }

    tx.oncomplete = () => resolve(results);
    tx.onerror = () => reject(tx.error);
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
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as Uint8Array | undefined);
    request.onerror = () => reject(request.error);
  });
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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const key of keys) {
      store.delete(key);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clears all entries from the chunks store.
 *
 * @param db - The IndexedDB database connection
 * @throws Error if the clear operation fails
 */
export async function clearDatabase(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
