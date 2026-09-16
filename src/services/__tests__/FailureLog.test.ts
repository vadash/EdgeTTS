import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { FailureLog } from '../FailureLog';

function makeLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as ILogger;
}

describe('FailureLog', () => {
  let logger: ILogger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it('returns an empty set when failed_chunks.json is missing', async () => {
    const dir = createMockDirectoryHandle();
    const log = new FailureLog(dir, logger);
    await expect(log.load()).resolves.toEqual(new Set<number>());
  });

  it('returns an empty set when failed_chunks.json is corrupt', async () => {
    const dir = createMockDirectoryHandle();
    const handle = await dir.getFileHandle('failed_chunks.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write('{not json');
    await writable.close();

    const log = new FailureLog(dir, logger);
    await expect(log.load()).resolves.toEqual(new Set<number>());
  });

  it('loads existing failed chunk indices as a set of numbers', async () => {
    const dir = createMockDirectoryHandle();
    const handle = await dir.getFileHandle('failed_chunks.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write('[3,1,2]');
    await writable.close();

    const log = new FailureLog(dir, logger);
    await expect(log.load()).resolves.toEqual(new Set([1, 2, 3]));
  });

  it('record unions with existing entries, writes sorted ascending, and resolves the total', async () => {
    const dir = createMockDirectoryHandle();
    const handle = await dir.getFileHandle('failed_chunks.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write('[4,1]');
    await writable.close();

    const log = new FailureLog(dir, logger);
    await expect(log.record([7, 2])).resolves.toBe(4);

    const loaded = await log.load();
    expect([...loaded]).toEqual([1, 2, 4, 7]);
  });

  it('record with an empty array leaves the file untouched', async () => {
    const dir = createMockDirectoryHandle();
    const log = new FailureLog(dir, logger);
    await expect(log.record([])).resolves.toBeNull();

    // File must not have been created
    await expect(dir.getFileHandle('failed_chunks.json')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('record resolves null and warns when the write fails', async () => {
    const dir = createMockDirectoryHandle();
    const log = new FailureLog(dir, logger);
    vi.spyOn(dir, 'getFileHandle').mockRejectedValue(new Error('disk on fire'));

    await expect(log.record([5])).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('disk on fire'));
  });
});
