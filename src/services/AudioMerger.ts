import { defaultConfig } from '@/config';
import { sanitizeFilename } from '@/utils/file';
import { withPermissionRetry } from '@/utils/retry';
import type { AudioSettings } from '@/state/types';
import type { FFmpegService } from './FFmpegService';
import { parseMP3Duration } from './MP3Parser';
import type { ChunkStore } from './ChunkStore';

export type MergeProgressCallback = (current: number, total: number, message: string) => void;

export interface MergedFile {
  fileName: string;
  folderName: string;
  blob: Blob;
  fromIndex: number;
  toIndex: number;
}

export interface MergeGroup {
  fromIndex: number;
  toIndex: number;
  folderName: string;
  fileName: string;
  mergeNumber: number;
  durationMs: number;
}

/**
 * Chapter name owning `index` in the Book's chapter table. A boundary
 * index of 0 never advances the walk.
 */
export function filenameFor(fileNames: Array<[string, number]>, index: number): string {
  let current = fileNames[0]?.[0] ?? 'audio';
  let nextBoundaryIdx = 0;
  while (
    nextBoundaryIdx < fileNames.length &&
    index >= fileNames[nextBoundaryIdx][1] &&
    fileNames[nextBoundaryIdx][1] > 0
  ) {
    current = fileNames[nextBoundaryIdx][0];
    nextBoundaryIdx++;
  }
  return current;
}

/**
 * On-disk identity for one merge group. The 4-digit number keeps files
 * in merge order when a chapter splits into several groups.
 */
function generateGroupFilename(
  chapterName: string,
  mergeNumber: number,
  totalGroups: number,
  extension: string,
): { folderName: string; fileName: string } {
  const folderName = sanitizeFilename(chapterName);

  if (totalGroups === 1) {
    return { folderName, fileName: `${folderName}.${extension}` };
  }

  const paddedNum = String(mergeNumber).padStart(4, '0');
  return { folderName, fileName: `${folderName} ${paddedNum}.${extension}` };
}

export interface MergerConfig {
  outputFormat: 'opus';
  // Audio settings, carried as one object from the Conversion input.
  audio: AudioSettings;
  // Optional FFmpegService factory for the parallel worker pool. With no
  // factory the pool is only the injected singleton, so encoding runs
  // sequentially.
  ffmpegFactory?: () => FFmpegService;
  // Availability source for the merge: the merger asks the Chunk store
  // which chunk indices exist.
  chunkStore: ChunkStore;
}

/**
 * Hard ceiling on parallel merge workers. The bundled `@ffmpeg/core` is
 * single-threaded (1 core per instance); beyond 4 workers the main
 * thread's ChunkStore I/O and cross-core contention erase the gains.
 */
const MAX_MERGE_CONCURRENCY = 4;

/**
 * Merges stored chunks into audio files with FFmpeg. Chunks are read
 * from disk when needed, so RAM usage stays low. Receives the
 * FFmpegService via constructor for testability.
 */
export class AudioMerger {
  private ffmpegService: FFmpegService;
  private config: MergerConfig;
  private targetDurationMs: number;
  private minDurationMs: number;
  private maxDurationMs: number;
  private chunkStore: ChunkStore;

  constructor(ffmpegService: FFmpegService, config: MergerConfig) {
    this.ffmpegService = ffmpegService;
    this.config = config;
    this.chunkStore = config.chunkStore;

    const targetMinutes = defaultConfig.audio.targetDurationMinutes;
    const tolerancePercent = defaultConfig.audio.tolerancePercent;

    this.targetDurationMs = targetMinutes * 60 * 1000;
    this.minDurationMs = this.targetDurationMs * (1 - tolerancePercent / 100);
    this.maxDurationMs = this.targetDurationMs * (1 + tolerancePercent / 100);
  }

  /**
   * Estimate duration from MP3 bytes. Edge TTS outputs 96 kbps constant
   * bitrate, which is the basis of the bytes-per-millisecond constant in
   * the config. Variable bitrate or resampled audio makes the estimate
   * inaccurate.
   */
  private estimateDurationMsFallback(bytes: number): number {
    return Math.round(bytes / defaultConfig.audio.bytesPerMs);
  }

  private async getDurationMs(index: number): Promise<number> {
    try {
      const audio = await this.chunkStore.readChunk(index);
      const parsedDuration = parseMP3Duration(audio);

      if (parsedDuration !== null && parsedDuration > 0) {
        return parsedDuration;
      }

      return this.estimateDurationMsFallback(audio.length);
    } catch {
      // An unreadable chunk gets duration 0, so grouping treats it like
      // a missing chunk.
      return 0;
    }
  }

  /**
   * Asks the Chunk store once which chunk indices exist. Missing chunks
   * count as silence with duration 0.
   */
  async calculateMergeGroups(
    chunkCount: number,
    fileNames: Array<[string, number]>,
  ): Promise<MergeGroup[]> {
    if (chunkCount === 0) return [];

    // Availability: one fetch covers the whole calculation.
    const available = this.chunkStore.getExistingIndices();

    let groupStart = 0;
    let groupDurationMs = 0;
    let mergeNumber = 1;
    let lastFilename = filenameFor(fileNames, 0);
    const spans: Array<Omit<MergeGroup, 'folderName' | 'fileName'>> = [];

    for (let i = 0; i < chunkCount; i++) {
      const currentFile = filenameFor(fileNames, i);
      const isFileBoundary = currentFile !== lastFilename;
      const isLastItem = i === chunkCount - 1;

      let chunkDurationMs = 0;
      if (available.has(i)) {
        chunkDurationMs = await this.getDurationMs(i);
      }

      const wouldExceedMax = groupDurationMs + chunkDurationMs > this.maxDurationMs;
      const canCloseGroup = groupDurationMs >= this.minDurationMs;

      if (isFileBoundary || isLastItem || (wouldExceedMax && canCloseGroup)) {
        // At a file boundary the current chunk starts the next group, so
        // it is excluded here.
        const toIndex = isFileBoundary ? i - 1 : i;
        const finalDuration = isFileBoundary ? groupDurationMs : groupDurationMs + chunkDurationMs;

        if (toIndex >= groupStart) {
          spans.push({
            fromIndex: groupStart,
            toIndex: toIndex,
            mergeNumber: mergeNumber,
            durationMs: finalDuration,
          });
        }

        if (isFileBoundary) {
          groupStart = i;
          groupDurationMs = chunkDurationMs;
          mergeNumber = 1;
          lastFilename = currentFile;
        } else if (!isLastItem) {
          groupStart = i + 1;
          groupDurationMs = 0;
          mergeNumber++;
        }
      } else {
        groupDurationMs += chunkDurationMs;
      }
    }

    // Name every group in one pass: the chapter of a group is the chapter of
    // its first chunk (a file boundary always closes the previous group).
    const totalGroups = spans.length;
    return spans.map((span) => ({
      ...span,
      ...generateGroupFilename(
        filenameFor(fileNames, span.fromIndex),
        span.mergeNumber,
        totalGroups,
        this.config.outputFormat,
      ),
    }));
  }

  /**
   * Reads chunks from disk one by one to keep memory low. A null entry
   * is a missing chunk and is replaced with silence.
   */
  private async mergeAudioGroupAsync(
    ffmpegService: FFmpegService,
    available: Set<number>,
    group: MergeGroup,
    onProgress?: (message: string) => void,
  ): Promise<MergedFile | null> {
    const chunks: (Uint8Array | null)[] = [];
    let missingCount = 0;

    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      if (available.has(i)) {
        try {
          const audio = await this.chunkStore.readChunk(i);
          chunks.push(audio);
        } catch {
          chunks.push(null);
          missingCount++;
        }
      } else {
        chunks.push(null);
        missingCount++;
      }
    }

    if (missingCount > 0) {
      onProgress?.(`Warning: ${missingCount} missing chunk(s) replaced with silence`);
    }

    // All chunks missing: return null so the caller skips the group and
    // saves no file.
    if (chunks.every((c) => c === null)) return null;

    const processedAudio = await ffmpegService.processAudio(chunks, this.config.audio, onProgress);

    // Copy into a new Uint8Array so the Blob gets a standard ArrayBuffer,
    // not a SharedArrayBuffer.
    const outputArray = new Uint8Array(processedAudio);

    return {
      fileName: group.fileName,
      folderName: group.folderName,
      blob: new Blob([outputArray], { type: 'audio/opus' }),
      fromIndex: group.fromIndex,
      toIndex: group.toIndex,
    };
  }

  /**
   * Check if a file exists and has content (> 1KB to avoid partial writes)
   */
  private async fileExistsWithContent(
    directoryHandle: FileSystemDirectoryHandle,
    filename: string,
    folderName: string,
  ): Promise<boolean> {
    try {
      const folderHandle = await directoryHandle.getDirectoryHandle(folderName);
      const fileHandle = await folderHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return file.size > 1024;
    } catch {
      return false;
    }
  }

  /**
   * Saves each file as soon as its group is merged, keeping RAM usage
   * low and preserving files already written if the Conversion is
   * interrupted.
   */
  async mergeAndSave(
    chunkCount: number,
    fileNames: Array<[string, number]>,
    saveDirectoryHandle: FileSystemDirectoryHandle,
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<number> {
    // Request write permission upfront so the merge is never interrupted
    // by a prompt.
    try {
      const permission = await saveDirectoryHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new Error('Directory permission denied. Please grant access to save files.');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('permission')) {
        throw err;
      }
      throw new Error(`Directory permission check failed: ${(err as Error).message}`);
    }

    const groups = await this.calculateMergeGroups(chunkCount, fileNames);

    // Availability: one fetch is shared by every group below.
    const available = this.chunkStore.getExistingIndices();

    // Sequential pre-pass: existing files are skipped here; the rest go
    // to the worker pool.
    const pending: MergeGroup[] = [];
    let skippedCount = 0;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const fileExists = await this.fileExistsWithContent(
        saveDirectoryHandle,
        group.fileName,
        group.folderName,
      );
      if (fileExists) {
        onProgress?.(i + 1, groups.length, `Skipping existing file: ${group.fileName}`);
        skippedCount++;
        continue;
      }
      pending.push(group);
    }

    // Build the worker pool. The injected singleton is always worker[0]
    // and is never terminated here; its lifecycle belongs to its owner.
    // Extra workers come from the factory and are terminated in `finally`
    // after the merge. No factory means the pool is only the singleton,
    // so concurrency stays 1.
    const workerCount = Math.max(
      1,
      Math.min(this.config.audio.mergeConcurrency, MAX_MERGE_CONCURRENCY),
    );
    const workers: FFmpegService[] = [this.ffmpegService];
    if (this.config.ffmpegFactory) {
      const target = Math.min(workerCount, Math.max(pending.length, 1));
      while (workers.length < target) {
        workers.push(this.config.ffmpegFactory());
      }
    }

    // Shared-index work queue: each worker pulls the next pending group
    // off the front. The first rejection aborts Promise.all, but
    // in-flight groups on other workers may still complete and save.
    // That is harmless because resume skips existing files.
    let nextIdx = 0;
    let completed = 0;
    let savedCount = 0;

    try {
      await Promise.all(
        workers.map(async (svc) => {
          while (nextIdx < pending.length) {
            const group = pending[nextIdx++];
            const groupOrder = groups.indexOf(group) + 1;
            const durationMin = Math.round(group.durationMs / 60000);
            onProgress?.(
              completed + 1,
              groups.length,
              `Processing part ${groupOrder}/${groups.length} (~${durationMin} min)`,
            );

            const merged = await this.mergeAudioGroupAsync(svc, available, group, (msg) =>
              onProgress?.(completed + 1, groups.length, msg),
            );

            if (merged) {
              // Save immediately to keep the low-RAM save-as-you-go
              // behavior.
              await this.saveToDirectory(merged, saveDirectoryHandle);
              onProgress?.(completed + 1, groups.length, `Saved ${merged.fileName}`);
              savedCount++;
            }
            completed++;
          }
        }),
      );
    } finally {
      // Terminate every pool worker except the injected singleton.
      for (let w = 1; w < workers.length; w++) {
        try {
          workers[w].terminate();
        } catch {
          // Best-effort cleanup.
        }
      }
    }

    if (skippedCount > 0) {
      onProgress?.(
        groups.length,
        groups.length,
        `Skipped ${skippedCount} existing file(s), saved ${savedCount}`,
      );
    }

    return savedCount;
  }

  private async saveToDirectory(
    file: MergedFile,
    directoryHandle: FileSystemDirectoryHandle,
  ): Promise<void> {
    await withPermissionRetry(directoryHandle, async () => {
      const folderHandle = await directoryHandle.getDirectoryHandle(file.folderName, {
        create: true,
      });
      const fileHandle = await folderHandle.getFileHandle(file.fileName, { create: true });
      const writableStream = await fileHandle.createWritable();
      await writableStream.write(file.blob);
      await writableStream.close();
    });
  }
}
