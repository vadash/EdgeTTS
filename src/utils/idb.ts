// Minimal promise wrappers for the IndexedDB event boilerplate shared by
// ChunkIDB, FFmpegBlobCache, and SecureStorage.
// Uses the Promise executor form: Promise.withResolvers needs lib ES2024,
// but tsconfig pins ES2021.

/**
 * Resolves with the request's result once it succeeds; rejects with its error.
 */
export function requestToPromise<T = unknown>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Resolves when the transaction completes; rejects on its error event.
 */
function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Opens a transaction and settles when both `run` and the transaction settle.
 * `run` issues requests synchronously while the transaction is active; the
 * transaction commits once no more requests are queued.
 */
export function withTransaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => T | PromiseLike<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  return Promise.all([Promise.resolve(run(tx)), transactionToPromise(tx)]).then(
    ([result]) => result,
  );
}

/**
 * Opens (and creates) a database, creating stores via the optional upgrade hook.
 */
export function openIDB(
  name: string,
  version: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    if (upgrade) {
      request.onupgradeneeded = () => upgrade(request.result);
    }
  });
}
