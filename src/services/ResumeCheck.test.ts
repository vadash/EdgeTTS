import { describe, expect, it } from 'vitest';

import { ChunkStore } from './ChunkStore';
import { checkResumeState } from './ResumeCheck';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { createMockChunkIdb } from '@/test/mocks/MockChunkIdb';

function createStore(): ChunkStore {
  return new ChunkStore(createMockChunkIdb());
}

async function seedWorkFolder(
  root: FileSystemDirectoryHandle,
  entries: Record<string, string | Uint8Array<ArrayBuffer>>,
): Promise<FileSystemDirectoryHandle> {
  const work = await root.getDirectoryHandle('_temp_work', { create: true });
  for (const [name, data] of Object.entries(entries)) {
    const handle = await work.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }
  return work;
}

describe('ResumeCheck', () => {
  it('should detect new format with chunks_index_0.jsonl', async () => {
    const root = createMockDirectoryHandle();
    await seedWorkFolder(root, {
      'chunks_data_0.bin': new Uint8Array([1, 2, 3, 4, 5]),
      'chunks_index_0.jsonl': '{"i":0,"o":0,"l":5}\n',
      'pipeline_state.json': '{"assignments":[]}',
    });

    const result = await checkResumeState(createStore(), root);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(1);
    expect(result!.hasLLMState).toBe(true);
  });

  it('should handle empty index file', async () => {
    const root = createMockDirectoryHandle();
    await seedWorkFolder(root, {
      'chunks_data_0.bin': new Uint8Array([]),
      'chunks_index_0.jsonl': '',
      'pipeline_state.json': '{"assignments":[]}',
    });

    const result = await checkResumeState(createStore(), root);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(0);
  });

  it('should detect new format with chunks_index_2.jsonl (any numbered variant)', async () => {
    const root = createMockDirectoryHandle();
    await seedWorkFolder(root, {
      'chunks_index_2.jsonl': '{"i":0,"o":0,"l":5}\n',
      'pipeline_state.json': '{"assignments":[]}',
    });

    const result = await checkResumeState(createStore(), root);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(1);
  });

  it('should return null when no _temp_work exists', async () => {
    const root = createMockDirectoryHandle();
    const result = await checkResumeState(createStore(), root);
    expect(result).toBeNull();
  });

  it('should sum line counts across multiple numbered index files', async () => {
    const root = createMockDirectoryHandle();
    await seedWorkFolder(root, {
      'chunks_data_0.bin': new Uint8Array([1, 2, 3]),
      'chunks_data_1.bin': new Uint8Array([4, 5]),
      'chunks_index_0.jsonl': '{"i":0,"o":0,"l":3}\n{"i":1,"o":3,"l":3}\n{"i":2,"o":6,"l":3}\n',
      'chunks_index_1.jsonl': '{"i":3,"o":0,"l":2}\n{"i":4,"o":2,"l":2}\n',
      'pipeline_state.json': '{"assignments":[]}',
    });

    const result = await checkResumeState(createStore(), root);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(5);
  });

  it('should return 0 cachedChunks when no numbered index files exist but pipeline_state does', async () => {
    const root = createMockDirectoryHandle();
    await seedWorkFolder(root, {
      'chunks_data_0.bin': new Uint8Array([1, 2, 3]),
      'pipeline_state.json': '{"assignments":[]}',
    });

    const result = await checkResumeState(createStore(), root);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(0);
    expect(result!.hasLLMState).toBe(true);
  });
});
