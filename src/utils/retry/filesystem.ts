import { filePermissionError } from '@/errors';

/**
 * Repo rule: every file system call goes through this helper, because the
 * browser can drop the security context at any time (AGENTS.md,
 * Boundaries). A NotAllowedError gets exactly one permission re-request
 * and one retry.
 */
export async function withPermissionRetry<T>(
  directoryHandle: FileSystemDirectoryHandle,
  operation: () => Promise<T>,
  notify?: (message: string) => void,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
      throw error;
    }

    notify?.('File system permission lost. Re-requesting access...');

    const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw filePermissionError(directoryHandle.name);
    }

    return await operation();
  }
}
