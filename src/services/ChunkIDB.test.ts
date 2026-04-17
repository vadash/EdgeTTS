// ChunkIDB.test.ts - Unit tests for IndexedDB layer

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  openDatabase,
  putChunk,
  getAllChunks,
  getAllKeys,
  getChunk,
  deleteKeys,
  clearDatabase,
  closeDatabase,
} from './ChunkIDB';

// Database and store constants
const DB_NAME = 'edgetts_hybrid_chunks';
const STORE_NAME = 'chunks';

/**
 * Minimal fake IndexedDB that supports the event-based IDB patterns.
 * Uses setTimeout(0) to simulate async event delivery, ensuring handlers
 * are registered before events fire.
 */
function createFakeIDB() {
  const store = new Map<number, Uint8Array>();

  const fakeDB = {
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((_storeName: string, _mode: string) => {
      const ops = {
        get: (key: number) => {
          const result = store.get(key);
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
            result,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
        put: (value: Uint8Array, key: number) => {
          store.set(key, value);
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
        delete: (key: number) => {
          store.delete(key);
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
        getAll: () => {
          const result = Array.from(store.values());
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
            result,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
        getAllKeys: () => {
          const result = Array.from(store.keys()).sort((a, b) => a - b);
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
            result,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
        clear: () => {
          store.clear();
          const req = {
            onsuccess: null as ((ev: any) => void) | null,
            onerror: null as ((ev: any) => void) | null,
          };
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess({});
          });
          return req;
        },
      };

      const tx = {
        objectStore: vi.fn(() => ops),
        oncomplete: null as (() => void) | null,
        onerror: null as ((ev: any) => void) | null,
      };

      // Fire oncomplete asynchronously so the caller has time to set tx.oncomplete
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 0);

      return tx;
    }),
  };

  const openRequest = {
    result: fakeDB,
    error: null as DOMException | null,
    onsuccess: null as ((ev: any) => void) | null,
    onerror: null as ((ev: any) => void) | null,
    onupgradeneeded: null as ((ev: any) => void) | null,
  };

  return { store, fakeDB, openRequest };
}

describe('ChunkIDB', () => {
  let fake: ReturnType<typeof createFakeIDB>;
  let originalIDB: any;

  beforeEach(() => {
    fake = createFakeIDB();
    originalIDB = window.indexedDB;

    // Replace indexedDB with our fake (setup.ts made it configurable)
    (window as any).indexedDB = {
      open: vi.fn(() => {
        const req = fake.openRequest;
        // Fire events asynchronously so the caller can set handlers first
        queueMicrotask(() => {
          if (req.onupgradeneeded) req.onupgradeneeded({} as any);
          if (req.onsuccess) req.onsuccess({} as any);
        });
        return req;
      }),
      deleteDatabase: vi.fn(),
    };
  });

  afterEach(() => {
    (window as any).indexedDB = originalIDB;
  });

  describe('openDatabase', () => {
    it('should open or create the database with correct name and version', async () => {
      const db = await openDatabase();

      expect(window.indexedDB.open).toHaveBeenCalledWith(DB_NAME, 1);
      expect(db).toBe(fake.fakeDB);
    });

    it('should create the chunks object store on upgrade', async () => {
      // Trigger onupgradeneeded by setting the handler
      fake.openRequest.onupgradeneeded = () => {
        fake.fakeDB.createObjectStore(STORE_NAME);
      };

      await openDatabase();

      expect(fake.fakeDB.createObjectStore).toHaveBeenCalledWith(STORE_NAME);
    });

    it('should reject on open error', async () => {
      const openError = new Error('Open failed');
      (window as any).indexedDB.open = vi.fn(() => {
        const req = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((error: Error) => void) | null,
          error: openError,
        };
        queueMicrotask(() => {
          if (req.onerror) req.onerror(openError);
        });
        return req;
      });

      await expect(openDatabase()).rejects.toThrow('Open failed');
    });
  });

  describe('putChunk', () => {
    it('should store a Uint8Array with a numeric key', async () => {
      const db = await openDatabase();
      const data = new Uint8Array([1, 2, 3, 4]);
      const key = 42;

      await putChunk(db, key, data);

      expect(fake.store.has(key)).toBe(true);
      expect(fake.store.get(key)).toEqual(data);
      expect(db.transaction).toHaveBeenCalledWith(STORE_NAME, 'readwrite');
    });

    it('should overwrite existing data for the same key', async () => {
      const db = await openDatabase();
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);
      const key = 1;

      await putChunk(db, key, data1);
      await putChunk(db, key, data2);

      expect(fake.store.get(key)).toEqual(data2);
    });
  });

  describe('getAllChunks', () => {
    it('should return all stored entries with keys and data', async () => {
      const db = await openDatabase();
      const entries = [
        { key: 0, data: new Uint8Array([1, 2]) },
        { key: 1, data: new Uint8Array([3, 4]) },
        { key: 5, data: new Uint8Array([5, 6]) },
      ];

      for (const entry of entries) {
        await putChunk(db, entry.key, entry.data);
      }

      const result = await getAllChunks(db);

      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining(entries));
      expect(db.transaction).toHaveBeenCalledWith(STORE_NAME, 'readonly');
    });

    it('should return empty array when no chunks exist', async () => {
      const db = await openDatabase();

      const result = await getAllChunks(db);

      expect(result).toEqual([]);
    });
  });

  describe('getAllKeys', () => {
    it('should return only keys without fetching payloads', async () => {
      const db = await openDatabase();
      const keys = [0, 1, 2, 5, 10];

      for (const key of keys) {
        await putChunk(db, key, new Uint8Array([key]));
      }

      const result = await getAllKeys(db);

      expect(result).toEqual(keys);
    });

    it('should return empty array when no chunks exist', async () => {
      const db = await openDatabase();

      const result = await getAllKeys(db);

      expect(result).toEqual([]);
    });
  });

  describe('getChunk', () => {
    it('should return a single Uint8Array for the specified key', async () => {
      const db = await openDatabase();
      const data = new Uint8Array([5, 6, 7, 8]);
      const key = 3;

      await putChunk(db, key, data);

      const result = await getChunk(db, key);

      expect(result).toEqual(data);
    });

    it('should return undefined for non-existent key', async () => {
      const db = await openDatabase();

      const result = await getChunk(db, 999);

      expect(result).toBeUndefined();
    });
  });

  describe('deleteKeys', () => {
    it('should delete multiple keys in a single transaction', async () => {
      const db = await openDatabase();
      const keys = [1, 3, 5];

      // Add some chunks
      for (const key of keys) {
        await putChunk(db, key, new Uint8Array([key]));
      }
      // Add an extra chunk that won't be deleted
      await putChunk(db, 2, new Uint8Array([2]));

      await deleteKeys(db, keys);

      expect(fake.store.has(1)).toBe(false);
      expect(fake.store.has(3)).toBe(false);
      expect(fake.store.has(5)).toBe(false);
      expect(fake.store.has(2)).toBe(true); // Should still exist
    });

    it('should handle empty keys array', async () => {
      const db = await openDatabase();

      // Should not throw
      await deleteKeys(db, []);

      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('clearDatabase', () => {
    it('should wipe all entries from the chunks store', async () => {
      const db = await openDatabase();

      // Add some chunks
      await putChunk(db, 0, new Uint8Array([1]));
      await putChunk(db, 1, new Uint8Array([2]));
      await putChunk(db, 2, new Uint8Array([3]));

      expect(fake.store.size).toBe(3);

      await clearDatabase(db);

      expect(fake.store.size).toBe(0);
      expect(db.transaction).toHaveBeenCalledWith(STORE_NAME, 'readwrite');
    });

    it('should handle clearing an already empty database', async () => {
      const db = await openDatabase();

      // Should not throw
      await clearDatabase(db);

      expect(fake.store.size).toBe(0);
    });
  });

  describe('closeDatabase', () => {
    it('should close the IDB connection', async () => {
      const db = await openDatabase();

      await closeDatabase(db);

      expect(db.close).toHaveBeenCalled();
    });
  });
});
