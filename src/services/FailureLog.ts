// Failure log for permanently failed TTS chunks.
// failed_chunks.json records chunk indices that exhausted retries so a
// resumed conversion can skip them (ADR-0002, ADR-0013). Entries carry an
// optional failure message (ADR-0018); legacy files holding bare index
// arrays load unchanged.

import { withPermissionRetry } from '@/utils/retry/filesystem';

import type { ILogger } from './Logger';

const FAILED_CHUNKS_FILE = 'failed_chunks.json';

/** A permanently failed chunk: index plus optional human-readable cause. */
export interface FailureEntry {
  index: number;
  message?: string;
}

function isFailureEntry(item: unknown): item is FailureEntry {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { index?: unknown }).index === 'number'
  );
}

export class FailureLog {
  constructor(
    private readonly tempDir: FileSystemDirectoryHandle,
    private readonly logger: ILogger,
  ) {}

  /**
   * Read failed_chunks.json as entries. Accepts the legacy bare-number array
   * and the current object format. Throws on a missing or corrupt file.
   */
  private async readEntries(): Promise<FailureEntry[]> {
    const failedHandle = await this.tempDir.getFileHandle(FAILED_CHUNKS_FILE);
    const failedFile = await failedHandle.getFile();
    const failedText = await failedFile.text();
    const raw: unknown = JSON.parse(failedText);
    if (!Array.isArray(raw)) return [];
    const entries: FailureEntry[] = [];
    for (const item of raw) {
      if (typeof item === 'number') {
        entries.push({ index: item });
      } else if (isFailureEntry(item)) {
        entries.push(item);
      }
    }
    return entries;
  }

  /**
   * Load the set of permanently failed chunk indices.
   * Missing or corrupt failed_chunks.json -> empty set.
   */
  async load(): Promise<Set<number>> {
    try {
      const entries = await withPermissionRetry(this.tempDir, () => this.readEntries());
      return new Set(entries.map((entry) => entry.index));
    } catch {
      // No failed_chunks.json or corrupted — treat as empty set
      return new Set<number>();
    }
  }

  /**
   * Persist failed chunk entries to the failure log: union with the existing
   * set (by index; a re-recorded index keeps its latest message), written as a sorted
   * JSON array. Resolves with the total set size after a successful write, or
   * null when nothing was written (empty input or a write failure, which is
   * warned instead of thrown). Never throws.
   */
  async record(entries: Iterable<FailureEntry>): Promise<number | null> {
    const additions = new Map<number, FailureEntry>();
    for (const entry of entries) {
      additions.set(entry.index, entry);
    }
    if (additions.size === 0) return null;
    let total: number | null = null;
    try {
      await withPermissionRetry(this.tempDir, async () => {
        // Union by index: existing entries keep their messages, new ones win.
        // A missing file starts a fresh union.
        let existing: FailureEntry[] = [];
        try {
          existing = await this.readEntries();
        } catch {
          // No failed_chunks.json yet
        }
        const union = new Map<number, FailureEntry>();
        for (const entry of existing) {
          union.set(entry.index, entry);
        }
        for (const [index, entry] of additions) {
          union.set(index, entry);
        }
        const sorted = [...union.values()].sort((a, b) => a.index - b.index);
        const failedJson = JSON.stringify(sorted);
        const failedFileHandle = await this.tempDir.getFileHandle(FAILED_CHUNKS_FILE, {
          create: true,
        });
        const writable = await failedFileHandle.createWritable();
        await writable.write(failedJson);
        await writable.close();
        total = union.size;
      });
    } catch (err) {
      this.logger.warn(`Failed to persist failed_chunks.json: ${(err as Error).message}`);
      return null;
    }
    return total;
  }
}
