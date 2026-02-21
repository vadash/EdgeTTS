// Filesystem retry utilities for permission recovery

import { filePermissionError } from '@/errors';

/**
 * Wraps a File System Access API operation with permission recovery.
 * On NotAllowedError, re-requests permission once, then retries.
 * Shows a notification before re-requesting permission.
 */
export async function withPermissionRetry<T>(
  directoryHandle: FileSystemDirectoryHandle,
  operation: () => Promise<T>,
  notify?: (message: string) => void
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
      throw error;
    }

    // Notify user that permission was lost
    notify?.('File system permission lost. Re-requesting access...');

    const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw filePermissionError(directoryHandle.name);
    }

    // Single retry after re-grant
    return await operation();
  }
}
