import { describe, expect, it, vi } from 'vitest';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { withPermissionRetry } from './filesystem';

describe('withPermissionRetry', () => {
  it('returns result on success without retry', async () => {
    const handle = createMockDirectoryHandle();
    const operation = vi.fn().mockResolvedValue('success');

    const result = await withPermissionRetry(handle, operation);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-NotAllowedError errors', async () => {
    const handle = createMockDirectoryHandle();
    const error = new Error('something else');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withPermissionRetry(handle, operation)).rejects.toThrow('something else');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries after NotAllowedError when permission re-granted', async () => {
    const handle = {
      ...createMockDirectoryHandle(),
      requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
    } as unknown as FileSystemDirectoryHandle;

    const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(notAllowedError)
      .mockResolvedValueOnce('retried-success');

    const result = await withPermissionRetry(handle, operation);

    expect(result).toBe('retried-success');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('throws AppError when permission denied on retry', async () => {
    const handle = {
      ...createMockDirectoryHandle(),
      requestPermission: vi.fn().mockResolvedValue('denied' as PermissionState),
      name: 'test-dir',
    } as unknown as FileSystemDirectoryHandle;

    const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
    const operation = vi.fn().mockRejectedValue(notAllowedError);

    await expect(withPermissionRetry(handle, operation)).rejects.toMatchObject({
      code: 'FILE_PERMISSION_DENIED',
    });
  });

  it('calls notify callback when permission is lost', async () => {
    const handle = {
      ...createMockDirectoryHandle(),
      requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
    } as unknown as FileSystemDirectoryHandle;

    const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
    const operation = vi.fn().mockRejectedValueOnce(notAllowedError).mockResolvedValueOnce('ok');
    const notify = vi.fn();

    await withPermissionRetry(handle, operation, notify);

    expect(notify).toHaveBeenCalledWith('File system permission lost. Re-requesting access...');
  });

  it('does not call notify when no error occurs', async () => {
    const handle = createMockDirectoryHandle();
    const operation = vi.fn().mockResolvedValue('ok');
    const notify = vi.fn();

    await withPermissionRetry(handle, operation, notify);

    expect(notify).not.toHaveBeenCalled();
  });
});
