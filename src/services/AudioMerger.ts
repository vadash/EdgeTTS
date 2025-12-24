// AudioMerger - Handles audio merging with duration-based grouping and FFmpeg processing
// Reads audio chunks from disk to prevent OOM
// Supports Opus encoding with silence removal and normalization

import { defaultConfig } from '@/config';
import { sanitizeFilename } from '@/utils/fileUtils';
import { parseMP3Duration } from './MP3Parser';
import type { IFFmpegService, IAudioMerger, MergeProgressCallback } from './interfaces';

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
  deEss: boolean;
  silenceGapMs: number;
}

/**
 * AudioMerger - Implements IAudioMerger interface
 * Reads audio chunks from disk to minimize RAM usage
 * Receives IFFmpegService via constructor for testability
 */
export class AudioMerger implements IAudioMerger {
  private ffmpegService: IFFmpegService;
  private config: MergerConfig;
  private targetDurationMs: number;
  private minDurationMs: number;
  private maxDurationMs: number;

  constructor(ffmpegService: IFFmpegService, config: MergerConfig) {
    this.ffmpegService = ffmpegService;
    this.config = config;

    // Duration settings from config
    const targetMinutes = defaultConfig.audio.targetDurationMinutes;
    const tolerancePercent = defaultConfig.audio.tolerancePercent;

    this.targetDurationMs = targetMinutes * 60 * 1000;
    this.minDurationMs = this.targetDurationMs * (1 - tolerancePercent / 100);
    this.maxDurationMs = this.targetDurationMs * (1 + tolerancePercent / 100);
  }

  /**
   * Estimate duration from MP3 bytes.
   *
   * HEURISTIC: Assumes 96kbps constant bitrate audio (Edge TTS default output).
   * At 96kbps: 96000 bits/sec = 12000 bytes/sec = 12 bytes/ms
   *
   * This is an approximation and may be inaccurate for:
   * - Variable bitrate (VBR) audio
   * - Audio with different sample rates
   * - Heavily compressed or expanded audio
   *
   * This is now used only as a fallback when MP3 header parsing fails.
   */
  private estimateDurationMsFallback(bytes: number): number {
    return Math.round(bytes / defaultConfig.audio.bytesPerMs);
  }

  /**
   * Get duration from MP3 file, with fallback to byte heuristic
   * Reads file from disk and parses MP3 headers for accurate duration
   */
  private async getDurationMs(
    filename: string,
    tempDirHandle: FileSystemDirectoryHandle
  ): Promise<number> {
    try {
      const audio = await this.readChunkFromDisk(filename, tempDirHandle);
      const parsedDuration = parseMP3Duration(audio);

      if (parsedDuration !== null && parsedDuration > 0) {
        return parsedDuration;
      }

      // Fallback to byte heuristic
      return this.estimateDurationMsFallback(audio.length);
    } catch {
      // If we can't read the file, return 0
      return 0;
    }
  }

  /**
   * Read a chunk file from disk
   */
  private async readChunkFromDisk(
    filename: string,
    tempDirHandle: FileSystemDirectoryHandle
  ): Promise<Uint8Array> {
    const fileHandle = await tempDirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Get file size from disk without reading the entire file
   */
  private async getFileSize(
    filename: string,
    tempDirHandle: FileSystemDirectoryHandle
  ): Promise<number> {
    const fileHandle = await tempDirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file.size;
  }

  /**
   * Calculate merge groups based on duration and file boundaries
   * Reads file sizes from disk to estimate durations
   */
  async calculateMergeGroups(
    audioMap: Map<number, string>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    tempDirHandle: FileSystemDirectoryHandle
  ): Promise<MergeGroup[]> {
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

      // Get actual duration from MP3 headers (with fallback to byte heuristic)
      const chunkFilename = audioMap.get(i);
      let chunkDurationMs = 0;
      if (chunkFilename) {
        chunkDurationMs = await this.getDurationMs(chunkFilename, tempDirHandle);
      }

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
   * Reads chunks from disk one by one
   */
  private async mergeAudioGroupSync(
    audioMap: Map<number, string>,
    group: MergeGroup,
    totalGroups: number,
    tempDirHandle: FileSystemDirectoryHandle
  ): Promise<MergedFile | null> {
    let totalSize = 0;
    const chunks: Uint8Array[] = [];

    // Read chunks one by one from disk
    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      const chunkFilename = audioMap.get(i);
      if (chunkFilename) {
        const audio = await this.readChunkFromDisk(chunkFilename, tempDirHandle);
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
   * Reads chunks from disk one by one to minimize memory
   * Missing chunks are replaced with silence placeholders
   */
  private async mergeAudioGroupAsync(
    audioMap: Map<number, string>,
    group: MergeGroup,
    totalGroups: number,
    tempDirHandle: FileSystemDirectoryHandle,
    onProgress?: (message: string) => void
  ): Promise<MergedFile | null> {
    const chunks: (Uint8Array | null)[] = [];
    let missingCount = 0;

    // Read chunks one by one from disk, null for missing
    for (let i = group.fromIndex; i <= group.toIndex; i++) {
      const chunkFilename = audioMap.get(i);
      if (chunkFilename) {
        const audio = await this.readChunkFromDisk(chunkFilename, tempDirHandle);
        chunks.push(audio);
      } else {
        chunks.push(null); // Missing chunk - will be replaced with silence
        missingCount++;
      }
    }

    // Warn about missing chunks
    if (missingCount > 0) {
      onProgress?.(`Warning: ${missingCount} missing chunk(s) replaced with silence`);
    }

    // Check if ALL chunks are missing
    if (chunks.every(c => c === null)) return null;

    // Use FFmpeg for Opus encoding
    if (this.config.outputFormat === 'opus' && this.ffmpegService.isAvailable()) {
      try {
        const processedAudio = await this.ffmpegService.processAudio(
          chunks,
          {
            silenceRemoval: this.config.silenceRemoval,
            normalization: this.config.normalization,
            deEss: this.config.deEss,
            silenceGapMs: this.config.silenceGapMs,
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
    return this.mergeAudioGroupSync(audioMap, group, totalGroups, tempDirHandle);
  }

  private generateFilename(group: MergeGroup, totalGroups: number, extension: string): string {
    const durationMin = Math.round(group.durationMs / 60000);
    const sanitizedName = sanitizeFilename(group.filename);

    if (totalGroups === 1) {
      return `${sanitizedName}.${extension}`;
    } else {
      const paddedNum = String(group.mergeNumber).padStart(4, '0');
      return `${sanitizedName} ${paddedNum}.${extension}`;
    }
  }

  /**
   * Merge all completed audio (async with FFmpeg support)
   * Reads audio chunks from disk to prevent OOM
   */
  async merge(
    audioMap: Map<number, string>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    tempDirHandle: FileSystemDirectoryHandle,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<MergedFile[]> {
    const groups = await this.calculateMergeGroups(audioMap, totalSentences, fileNames, tempDirHandle);
    const results: MergedFile[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const durationMin = Math.round(group.durationMs / 60000);
      onProgress?.(i + 1, groups.length, `Processing part ${i + 1}/${groups.length} (~${durationMin} min)`);

      const merged = await this.mergeAudioGroupAsync(
        audioMap,
        group,
        groups.length,
        tempDirHandle,
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
    const folderName = sanitizeFilename(
      file.filename
        .replace(/\s+\d{4}\.(mp3|opus)$/, '')
        .replace(/\.(mp3|opus)$/, '')
    );

    const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await folderHandle.getFileHandle(file.filename, { create: true });
    const writableStream = await fileHandle.createWritable();
    await writableStream.write(file.blob);
    await writableStream.close();
  }
}
