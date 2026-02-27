import { describe, expect, it, vi } from 'vitest';
import { DebugLogger } from './DebugLogger';

function createMockDirectoryHandle() {
  const mockWritable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockFileHandle = {
    createWritable: vi.fn().mockResolvedValue(mockWritable),
  };
  const mockLogsFolder = {
    getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  };
  const mockDirHandle = {
    getDirectoryHandle: vi.fn().mockResolvedValue(mockLogsFolder),
  } as unknown as FileSystemDirectoryHandle;

  return { mockDirHandle, mockLogsFolder, mockFileHandle, mockWritable };
}

describe('DebugLogger', () => {
  it('writes JSON to logs folder', async () => {
    const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveLog('test.json', { foo: 'bar' });

    expect(mockDirHandle.getDirectoryHandle).toHaveBeenCalledWith('logs', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('test.json', { create: true });
    expect(mockWritable.write).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }, null, 2));
    expect(mockWritable.close).toHaveBeenCalled();
  });

  it('does nothing when no directory handle', async () => {
    const logger = new DebugLogger(null);
    // Should not throw
    await logger.saveLog('test.json', { data: 1 });
  });

  it('swallows errors and logs warning', async () => {
    const mockDirHandle = {
      getDirectoryHandle: vi.fn().mockRejectedValue(new Error('FS error')),
    } as unknown as FileSystemDirectoryHandle;
    const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const logger = new DebugLogger(mockDirHandle, mockLogger as any);

    await logger.saveLog('test.json', { data: 1 });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to save log',
      expect.objectContaining({ error: 'FS error' }),
    );
  });

  it('tracks first-call-per-pass via shouldLog/markLogged', () => {
    const logger = new DebugLogger(null);
    expect(logger.shouldLog('extract')).toBe(true);
    logger.markLogged('extract');
    expect(logger.shouldLog('extract')).toBe(false);

    // Reset
    logger.resetLogging();
    expect(logger.shouldLog('extract')).toBe(true);
  });
});
