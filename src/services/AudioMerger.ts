// AudioMerger - Handles audio merging with duration-based grouping and FFmpeg processing
// Supports Opus encoding with silence removal and normalization

import { ffmpegService, type AudioProcessingConfig } from './FFmpegService';
import { defaultConfig } from '@/config';

export interface MergedFile {
  filename: string;
  blob: Blob;
  fromIndex: number;
  toIndex: number;
}

export interface MergeGroup {
  fromIndex: number;
  toIndex: number;
  filename: string;
  mergeNumber: number;
  durationMs: number;
}

export interface MergerConfig {
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
}

export class AudioMerger {
  private config: MergerConfig;
  private targetDurationMs: number;
  private minDurationMs: number;
  private maxDurationMs: number;

  constructor(config: MergerConfig) {
    this.config = config;

    // Duration settings from config
    const targetMinutes = defaultConfig.audio.targetDurationMinutes;
    const tolerancePercent = defaultConfig.audio.tolerancePercent;

    this.targetDurationMs = targetMinutes * 60 * 1000;
    this.minDurationMs = this.targetDurationMs * (1 - tolerancePercent / 100);
    this.maxDurationMs = this.targetDurationMs * (1 + tolerancePercent / 100);
  }

  /**
   * Estimate duration from MP3 bytes (96kbps = 12 bytes/ms)
   */
  private estimateDurationMs(bytes: number): number {
    return Math.round(bytes / defaultConfig.audio.bytesPerMs);
  }

  /**
   * Calculate merge groups based on duration and file boundaries
   */
  calculateMergeGroups(
    audioMap: Map<number, Uint8Array>,
    totalSentences: number,
    fileNames: Array<[string, number]>
  ): MergeGroup[] {
    const groups: MergeGroup[] = [];

    if (totalSentences === 0) return groups;

    // Create a map of index -> filename
    const indexToFilename = new Map<number, string>();
    let currentFilename = fileNames[0]?.[0] ?? 'audio';
    let nextBoundaryIdx = 0;

    for (let i = 0; i < totalSentences; i++) {
      while (
        nextBoundaryIdx < fileNames.length &&
        i >= fileNames[nextBoundaryIdx][1] &&
        fileNames[nextBoundaryIdx][1] > 0
      ) {
        currentFilename = fileNames[nextBoundaryIdx][0];
        nextBoundaryIdx++;
      }
      indexToFilename.set(i, currentFilename);
    }

    // Build merge groups based on duration
    let groupStart = 0;
    let groupDurationMs = 0;
    let mergeNumber = 1;
    let lastFilename = indexToFilename.get(0) ?? 'audio';

    for (let i = 0; i < totalSentences; i++) {
      const currentFile = indexToFilename.get(i) ?? 'audio';
      const isFileBoundary = currentFile !== lastFilename;
      const isLastItem = i === totalSentences - 1;

      const chunkBytes = audioMap.get(i)?.length ?? 0;
      const chunkDurationMs = this.estimateDurationMs(chunkBytes);

      // Check if adding this chunk would exceed max duration
      const wouldExceedMax = groupDurationMs + chunkDurationMs > this.maxDurationMs;
      // Check if current duration is acceptable to close group
      const canCloseGroup = groupDurationMs >= this.minDurationMs;

      if (isFileBoundary || isLastItem || (wouldExceedMax && canCloseGroup)) {
        // Include current chunk if not a file boundary
        const toIndex = isFileBoundary ? i - 1 : i;
        const finalDuration = isFileBoundary ? groupDurationMs : groupDurationMs + chunkDurationMs;

        if (toIndex >= groupStart) {
          groups.push({
            fromIndex: groupStart,
            toIndex: toIndex,
            filename: lastFilename,
            mergeNumber: mergeNumber,
            durationMs: finalDuration,
          });
        }

        // Start new group
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

    return groups;
  }

  /**
   * Merge audio data for a group (sync, MP3 only)
   */
  private mergeAudioGroupSync(
    audioMap: Map<number, Uint8Array>,
    group: MergeGroup,
    totalGroups: number
  ): MergedFile | null {
    let totalSize = 0;
    const chunks: Uint8Array[] = [];

    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      const audio = audioMap.get(i);
      if (audio) {
        totalSize += audio.length;
        chunks.push(audio);
      }
    }

    if (totalSize === 0) return null;

    // Combine into single Uint8Array
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const filename = this.generateFilename(group, totalGroups, 'mp3');

    return {
      filename,
      blob: new Blob([combined.buffer], { type: 'audio/mpeg' }),
      fromIndex: group.fromIndex,
      toIndex: group.toIndex,
    };
  }

  /**
   * Merge audio data for a group with FFmpeg processing (async)
   */
  private async mergeAudioGroupAsync(
    audioMap: Map<number, Uint8Array>,
    group: MergeGroup,
    totalGroups: number,
    onProgress?: (message: string) => void
  ): Promise<MergedFile | null> {
    const chunks: Uint8Array[] = [];

    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      const audio = audioMap.get(i);
      if (audio) {
        chunks.push(audio);
      }
    }

    if (chunks.length === 0) return null;

    // Use FFmpeg for Opus encoding
    if (this.config.outputFormat === 'opus' && ffmpegService.isAvailable()) {
      try {
        const processedAudio = await ffmpegService.processAudio(
          chunks,
          {
            silenceRemoval: this.config.silenceRemoval,
            normalization: this.config.normalization,
          },
          onProgress
        );

        const filename = this.generateFilename(group, totalGroups, 'opus');

        // Create a new Uint8Array to ensure it's a standard ArrayBuffer (not SharedArrayBuffer)
        const outputArray = new Uint8Array(processedAudio);

        return {
          filename,
          blob: new Blob([outputArray], { type: 'audio/opus' }),
          fromIndex: group.fromIndex,
          toIndex: group.toIndex,
        };
      } catch (err) {
        onProgress?.(`FFmpeg error, falling back to MP3: ${(err as Error).message}`);
        // Fall through to MP3 fallback
      }
    }

    // MP3 fallback - simple concatenation
    return this.mergeAudioGroupSync(audioMap, group, totalGroups);
  }

  private generateFilename(group: MergeGroup, totalGroups: number, extension: string): string {
    const durationMin = Math.round(group.durationMs / 60000);

    if (totalGroups === 1) {
      return `${group.filename}.${extension}`;
    } else {
      const paddedNum = String(group.mergeNumber).padStart(4, '0');
      return `${group.filename} ${paddedNum}.${extension}`;
    }
  }

  /**
   * Merge all completed audio (async with FFmpeg support)
   */
  async merge(
    audioMap: Map<number, Uint8Array>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<MergedFile[]> {
    const groups = this.calculateMergeGroups(audioMap, totalSentences, fileNames);
    const results: MergedFile[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const durationMin = Math.round(group.durationMs / 60000);
      onProgress?.(i + 1, groups.length, `Processing part ${i + 1}/${groups.length} (~${durationMin} min)`);

      const merged = await this.mergeAudioGroupAsync(
        audioMap,
        group,
        groups.length,
        (msg) => onProgress?.(i + 1, groups.length, msg)
      );

      if (merged) {
        results.push(merged);
      }
    }

    return results;
  }

  /**
   * Save merged files to directory
   */
  async saveMergedFiles(
    files: MergedFile[],
    directoryHandle?: FileSystemDirectoryHandle | null
  ): Promise<void> {
    if (!directoryHandle) {
      throw new Error('Directory handle required. Please select a save folder.');
    }

    try {
      const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new Error('Directory permission denied. Please grant access to save files.');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('permission')) {
        throw err;
      }
      throw new Error(`Directory permission check failed: ${(err as Error).message}`);
    }

    for (const file of files) {
      await this.saveToDirectory(file, directoryHandle);
    }
  }

  private async saveToDirectory(
    file: MergedFile,
    directoryHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    // Extract folder name from filename (remove extension and part number)
    const folderName = file.filename
      .replace(/\s+\d{4}\.(mp3|opus)$/, '')
      .replace(/\.(mp3|opus)$/, '');

    const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await folderHandle.getFileHandle(file.filename, { create: true });
    const writableStream = await fileHandle.createWritable();
    await writableStream.write(file.blob);
    await writableStream.close();
  }
}
