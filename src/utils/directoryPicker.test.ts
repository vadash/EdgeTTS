import { describe, expect, it, vi } from 'vitest';
import { type DirectoryPickerEnv, selectOutputDirectory } from './directoryPicker';

const INSECURE = 'Folder saving requires a secure page. Open the app over HTTPS or on localhost.';
const UNSUPPORTED =
  'Folder saving is not supported in this browser. Use desktop Chrome, Edge, or Opera.';
const EXPIRED = 'Folder access expired. Click Save to MP3 again to choose a folder.';
const SECURITY =
  "Folder saving is blocked in this browser context. Open the app in desktop Chrome or Edge, not inside an app's built-in browser.";
const ABORT = 'Directory selection required. Please select a folder to save files.';
const GENERIC = 'Directory selection failed. Try desktop Chrome or Edge.';

function makeHandle(name = 'Books') {
  const queryPermission = vi.fn<() => Promise<PermissionState>>();
  return {
    handle: { name, queryPermission } as unknown as FileSystemDirectoryHandle,
    queryPermission,
  };
}

function makeEnv(overrides: Partial<DirectoryPickerEnv> = {}) {
  const picker = vi.fn<NonNullable<Window['showDirectoryPicker']>>();
  const getHandle = vi.fn<() => FileSystemDirectoryHandle | null>(() => null);
  const setHandle = vi.fn<(handle: FileSystemDirectoryHandle | null) => void>();
  const logInfo = vi.fn<(message: string) => void>();
  const logError = vi.fn<(message: string) => void>();
  const env: DirectoryPickerEnv = {
    isSecureContext: true,
    showDirectoryPicker: picker,
    getHandle,
    setHandle,
    logInfo,
    logError,
    ...overrides,
  };
  return { env, picker, getHandle, setHandle, logInfo, logError };
}

describe('selectOutputDirectory', () => {
  it('rejects an insecure context without reading the handle or calling the picker', async () => {
    const { env, picker, getHandle, logError } = makeEnv({ isSecureContext: false });

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(INSECURE);
    expect(getHandle).not.toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
  });

  it('reports unsupported browsers when the picker is absent', async () => {
    const { env, logError } = makeEnv({ showDirectoryPicker: undefined });

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(UNSUPPORTED);
  });

  it('reuses a stored handle whose readwrite permission is granted', async () => {
    const { handle, queryPermission } = makeHandle('Library');
    queryPermission.mockResolvedValue('granted');
    const { env, picker, setHandle, logInfo } = makeEnv({ getHandle: () => handle });

    await expect(selectOutputDirectory(env)).resolves.toBe(true);

    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(logInfo).toHaveBeenCalledWith('Saving to: Library');
    expect(setHandle).not.toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
  });

  it.each([
    'prompt',
    'denied',
  ] as const)('clears a stored handle when permission is %s', async (state) => {
    const { handle, queryPermission } = makeHandle();
    queryPermission.mockResolvedValue(state);
    const { env, picker, setHandle, logError } = makeEnv({ getHandle: () => handle });

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(setHandle).toHaveBeenCalledWith(null);
    expect(logError).toHaveBeenCalledWith(EXPIRED);
    expect(picker).not.toHaveBeenCalled();
  });

  it('clears a stored handle when queryPermission throws', async () => {
    const { handle, queryPermission } = makeHandle();
    queryPermission.mockRejectedValue(new Error('detached'));
    const { env, picker, setHandle, logError } = makeEnv({ getHandle: () => handle });

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(setHandle).toHaveBeenCalledWith(null);
    expect(logError).toHaveBeenCalledWith(EXPIRED);
    expect(picker).not.toHaveBeenCalled();
  });

  it('stores the handle chosen by the picker', async () => {
    const { handle } = makeHandle('Downloads');
    const { env, picker, setHandle, logInfo } = makeEnv();
    picker.mockResolvedValue(handle);

    await expect(selectOutputDirectory(env)).resolves.toBe(true);

    expect(picker).toHaveBeenCalledOnce();
    expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(setHandle).toHaveBeenCalledWith(handle);
    expect(logInfo).toHaveBeenCalledWith('Saving to: Downloads');
  });

  it('keeps the existing message when the user aborts the picker', async () => {
    const { env, picker, setHandle, logError } = makeEnv();
    picker.mockRejectedValue(Object.assign(new Error('canceled'), { name: 'AbortError' }));

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(ABORT);
    expect(setHandle).not.toHaveBeenCalled();
  });

  it('explains a SecurityError as a blocked browser context', async () => {
    const { env, picker, setHandle, logError } = makeEnv();
    picker.mockRejectedValue(
      Object.assign(new Error('The request is not allowed by the user agent'), {
        name: 'SecurityError',
      }),
    );

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(SECURITY);
    expect(setHandle).not.toHaveBeenCalled();
  });

  it('hides raw browser text behind a generic message for unknown errors', async () => {
    const { env, picker, logError } = makeEnv();
    picker.mockRejectedValue(new Error('Internal DOMException 0x8000000B'));

    await expect(selectOutputDirectory(env)).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(GENERIC);
    expect(logError.mock.calls[0]?.[0]).not.toContain('0x8000000B');
  });
});
