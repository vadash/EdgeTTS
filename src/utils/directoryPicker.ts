export interface DirectoryPickerEnv {
  isSecureContext: boolean;
  showDirectoryPicker?: Window['showDirectoryPicker'];
  getHandle: () => FileSystemDirectoryHandle | null;
  setHandle: (handle: FileSystemDirectoryHandle | null) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
}

const MESSAGES = {
  insecure: 'Folder saving requires a secure page. Open the app over HTTPS or on localhost.',
  unsupported:
    'Folder saving is not supported in this browser. Use desktop Chrome, Edge, or Opera.',
  expired: 'Folder access expired. Click Save to MP3 again to choose a folder.',
  blocked:
    "Folder saving is blocked in this browser context. Open the app in desktop Chrome or Edge, not inside an app's built-in browser.",
  abort: 'Directory selection required. Please select a folder to save files.',
  generic: 'Directory selection failed. Try desktop Chrome or Edge.',
} as const;

/**
 * Chooses the folder that receives the MP3 output.
 *
 * A File System Access picker call needs a secure page and a user gesture, so
 * every precondition is checked before the picker runs. Only a handle with
 * readwrite permission yields `true`; the caller must not start a conversion
 * on `false`.
 */
export async function selectOutputDirectory(env: DirectoryPickerEnv): Promise<boolean> {
  if (!env.isSecureContext) {
    env.logError(MESSAGES.insecure);
    return false;
  }

  if (!env.showDirectoryPicker) {
    env.logError(MESSAGES.unsupported);
    return false;
  }

  // Permissions do not survive a page reload, so a stored handle must be
  // revalidated before reuse. A failed check never falls through to the
  // picker, because the picker needs a fresh user gesture the caller cannot
  // provide at this point.
  const stored = env.getHandle();
  if (stored) {
    try {
      const permission = await stored.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        env.logInfo(`Saving to: ${stored.name}`);
        return true;
      }
    } catch {
      // A detached or revoked handle is treated like an expired permission.
    }
    env.setHandle(null);
    env.logError(MESSAGES.expired);
    return false;
  }

  try {
    const handle = await env.showDirectoryPicker({ mode: 'readwrite' });
    env.setHandle(handle);
    env.logInfo(`Saving to: ${handle.name}`);
    return true;
  } catch (err) {
    env.logError(pickerErrorMessage(err));
    return false;
  }
}

function pickerErrorMessage(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return MESSAGES.abort;
  if (name === 'SecurityError') return MESSAGES.blocked;
  return MESSAGES.generic;
}
