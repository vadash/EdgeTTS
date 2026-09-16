import { vi, type Mock } from 'vitest';

import type { ChunkIdbAdapter } from '@/services/ChunkIDB';

/** ChunkIdbAdapter with every method kept as a vi.fn Mock (spy/override). */
export type MockChunkIdb = {
  [K in keyof ChunkIdbAdapter]: Mock<ChunkIdbAdapter[K]>;
} & {
  /** Backing store — inspect or seed it directly in tests. */
  store: Map<number, Uint8Array>;
};

/**
 * In-memory ChunkIdbAdapter fake backed by a Map. Every method is an async
 * vi.fn so promises always resolve asynchronously (repo rule: IDB mocks must
 * fire async or promises hang — see src/test/AGENTS.md) and can be spied on
 * or overridden per test.
 */
export function createMockChunkIdb(): MockChunkIdb {
  const store = new Map<number, Uint8Array>();
  const db = { name: 'mock-chunk-idb' } as unknown as IDBDatabase;

  const adapter: ChunkIdbAdapter = {
    openDatabase: async () => db,
    putChunk: async (_db, index, data) => {
      store.set(index, data);
    },
    getAllChunks: async (_db) => Array.from(store, ([key, data]) => ({ key, data })),
    getAllKeys: async (_db) => [...store.keys()],
    getChunksByKeys: async (_db, keys) => keys.map((key) => ({ key, data: store.get(key) })),
    getChunk: async (_db, key) => store.get(key),
    deleteKeys: async (_db, keys) => {
      for (const key of keys) store.delete(key);
    },
    clearDatabase: async (_db) => {
      store.clear();
    },
    closeDatabase: async (_db) => {},
  };

  return {
    store,
    openDatabase: vi.fn(adapter.openDatabase),
    putChunk: vi.fn(adapter.putChunk),
    getAllChunks: vi.fn(adapter.getAllChunks),
    getAllKeys: vi.fn(adapter.getAllKeys),
    getChunksByKeys: vi.fn(adapter.getChunksByKeys),
    getChunk: vi.fn(adapter.getChunk),
    deleteKeys: vi.fn(adapter.deleteKeys),
    clearDatabase: vi.fn(adapter.clearDatabase),
    closeDatabase: vi.fn(adapter.closeDatabase),
  };
}
