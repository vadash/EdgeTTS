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
    // The call must not throw.
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

  it('saveErrorLog writes sequential rN.json and aN.json files', async () => {
    const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ model: 'gpt-4', messages: [] }, '{"invalid": json}');

    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a1.json', { create: true });

    const writeCalls = mockWritable.write.mock.calls;
    expect(writeCalls[0][0]).toContain('gpt-4'); // request content
    expect(writeCalls[1][0]).toContain('"content"'); // response has wrapped content
    expect(writeCalls[1][0]).toContain('invalid'); // contains the response content
  });

  it('saveErrorLog increments counter for each call', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ req: 1 }, 'response 1');
    await logger.saveErrorLog({ req: 2 }, 'response 2');

    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r2.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a2.json', { create: true });
  });

  it('resetLogging resets error counter', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ req: 1 }, 'response 1');
    logger.resetLogging();
    await logger.saveErrorLog({ req: 2 }, 'response 2');

    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    const r2Calls = mockLogsFolder.getFileHandle.mock.calls.filter(
      (call: any[]) => call[0] === 'r2.json',
    );
    expect(r2Calls).toHaveLength(0);
  });

  it('saveErrorLog does nothing when no directory handle', async () => {
    const logger = new DebugLogger(null);
    // The call must not throw.
    await logger.saveErrorLog({ req: 1 }, 'response');
  });

  it('savePhaseLog writes phase_request.json and phase_response.json files', async () => {
    const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.savePhaseLog('extract', { model: 'gpt-4', messages: [] }, { characters: [] });

    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', {
      create: true,
    });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', {
      create: true,
    });

    const writeCalls = mockWritable.write.mock.calls;
    expect(writeCalls[0][0]).toContain('gpt-4'); // request content
    expect(writeCalls[1][0]).toContain('characters'); // response content
  });

  it('savePhaseLog only logs first call per phase', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', {
      create: true,
    });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', {
      create: true,
    });

    // Clear the mock so only the second call is observed.
    mockLogsFolder.getFileHandle.mockClear();

    await logger.savePhaseLog('extract', { req: 2 }, { res: 2 });
    expect(mockLogsFolder.getFileHandle).not.toHaveBeenCalled();
  });

  it('savePhaseLog logs different phases independently', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.savePhaseLog('extract', { phase: 'extract' }, { result: 'extract' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', {
      create: true,
    });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', {
      create: true,
    });

    await logger.savePhaseLog('merge', { phase: 'merge' }, { result: 'merge' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('merge_request.json', {
      create: true,
    });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('merge_response.json', {
      create: true,
    });

    await logger.savePhaseLog('assign', { phase: 'assign' }, { result: 'assign' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('assign_request.json', {
      create: true,
    });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('assign_response.json', {
      create: true,
    });
  });

  it('resetLogging clears phase tracking', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledTimes(2); // request + response

    mockLogsFolder.getFileHandle.mockClear();

    logger.resetLogging();

    await logger.savePhaseLog('extract', { req: 2 }, { res: 2 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledTimes(2); // request + response
  });

  it('savePhaseLog does nothing when no directory handle', async () => {
    const logger = new DebugLogger(null);
    // The call must not throw.
    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
  });
});
