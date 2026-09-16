// Failure log for permanently failed TTS chunks.
// failed_chunks.json records chunk indices that exhausted retries so a
// resumed conversion can skip them (ADR-0002, ADR-0013).

import { withPermissionRetry } from '@/utils/retry/filesystem';

import type { ILogger } from './Logger';

const FAILED_CHUNKS_FILE = 'failed_chunks.json';

export class FailureLog {
  constructor(
    private readonly tempDir: FileSystemDirectoryHandle,
    private readonly logger: ILogger,
  ) {}

  /**
   * Load the set of permanently failed chunk indices.
   * Missing or corrupt failed_chunks.json -> empty set.
   */
  async load(): Promise<Set<number>> {
    try {
      return await withPermissionRetry(this.tempDir, async () => {
        const failedHandle = await this.tempDir.getFileHandle(FAILED_CHUNKS_FILE);
        const failedFile = await failedHandle.getFile();
        const failedText = await failedFile.text();
        const failedIndices: number[] = JSON.parse(failedText);
        return new Set(failedIndices);
      });
    } catch {
      // No failed_chunks.json or corrupted — treat as empty set
      return new Set<number>();
    }
  }

  /**
   * Persist chunk indices to the failure log: union with the existing set,
   * written as a sorted JSON array. Never throws.
   */
  async record(indices: Iterable<number>): Promise<void> {
    const additions = new Set(indices);
    if (additions.size === 0) return;
    try {
      await withPermissionRetry(this.tempDir, async () => {
        const existingFailed = await this.load();
        for (const idx of additions) {
          existingFailed.add(idx);
        }
        const failedJson = JSON.stringify([...existingFailed].sort((a, b) => a - b));
        const failedFileHandle = await this.tempDir.getFileHandle(FAILED_CHUNKS_FILE, {
          create: true,
        });
        const writable = await failedFileHandle.createWritable();
        await writable.write(failedJson);
        await writable.close();
      });
    } catch (err) {
      this.logger.warn(`Failed to persist failed_chunks.json: ${(err as Error).message}`);
    }
  }
}
