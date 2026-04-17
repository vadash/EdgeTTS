import { describe, it, expect } from 'vitest';
import { createMockDirectoryHandle } from './FileSystemMocks';

describe('FileSystemMocks — numbered chunk files', () => {
  it('creates numbered chunk data files via getFileHandle with create:true', async () => {
    const dir = createMockDirectoryHandle();

    const h0 = await dir.getFileHandle('chunks_data_0.bin', { create: true });
    const h1 = await dir.getFileHandle('chunks_data_1.bin', { create: true });
    const h2 = await dir.getFileHandle('chunks_data_2.bin', { create: true });

    expect(h0.name).toBe('chunks_data_0.bin');
    expect(h1.name).toBe('chunks_data_1.bin');
    expect(h2.name).toBe('chunks_data_2.bin');
  });

  it('creates numbered chunk index files via getFileHandle with create:true', async () => {
    const dir = createMockDirectoryHandle();

    const h0 = await dir.getFileHandle('chunks_index_0.jsonl', { create: true });
    const h1 = await dir.getFileHandle('chunks_index_1.jsonl', { create: true });

    expect(h0.name).toBe('chunks_index_0.jsonl');
    expect(h1.name).toBe('chunks_index_1.jsonl');
  });

  it('writes and reads back numbered chunk data files', async () => {
    const dir = createMockDirectoryHandle();

    const h0 = await dir.getFileHandle('chunks_data_0.bin', { create: true });
    const w = await h0.createWritable();
    await w.write(new Uint8Array([1, 2, 3, 4]));
    await w.close();

    const file = await h0.getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    expect(data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('removes numbered chunk files via removeEntry', async () => {
    const dir = createMockDirectoryHandle();

    await dir.getFileHandle('chunks_data_0.bin', { create: true });
    await dir.getFileHandle('chunks_data_1.bin', { create: true });

    await dir.removeEntry('chunks_data_0.bin');

    await expect(dir.getFileHandle('chunks_data_0.bin')).rejects.toThrow('File not found');
    // The second file should still exist
    const h1 = await dir.getFileHandle('chunks_data_1.bin');
    expect(h1.name).toBe('chunks_data_1.bin');
  });

  it('lists all numbered files via entries()', async () => {
    const dir = createMockDirectoryHandle();

    await dir.getFileHandle('chunks_data_0.bin', { create: true });
    await dir.getFileHandle('chunks_data_1.bin', { create: true });
    await dir.getFileHandle('chunks_index_0.jsonl', { create: true });

    const entries: string[] = [];
    for await (const [name] of dir.entries()) {
      entries.push(name);
    }

    expect(entries.sort()).toEqual([
      'chunks_data_0.bin',
      'chunks_data_1.bin',
      'chunks_index_0.jsonl',
    ]);
  });

  it('lists all numbered files via keys()', async () => {
    const dir = createMockDirectoryHandle();

    await dir.getFileHandle('chunks_data_0.bin', { create: true });
    await dir.getFileHandle('chunks_index_0.jsonl', { create: true });

    const keys: string[] = [];
    for await (const key of dir.keys()) {
      keys.push(key);
    }

    expect(keys.sort()).toEqual(['chunks_data_0.bin', 'chunks_index_0.jsonl']);
  });

  it('throws NotFoundError for non-existent numbered file without create', async () => {
    const dir = createMockDirectoryHandle();

    await expect(dir.getFileHandle('chunks_data_99.bin')).rejects.toThrow('File not found');
  });
});
