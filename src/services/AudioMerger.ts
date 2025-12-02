// AudioMerger - Handles MP3 concatenation based on merge settings
// Ported from legacy do_marge() logic in script.js

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
}

export class AudioMerger {
  private mergeCount: number;
  private fileBoundaries: number[] = []; // Indices where file changes

  constructor(mergeCount: number) {
    // 100+ means merge all
    this.mergeCount = mergeCount >= 100 ? Infinity : mergeCount;
  }

  setFileBoundaries(fileNames: Array<[string, number]>): void {
    // fileNames is array of [filename, boundaryIndex]
    // Extract boundary indices (where new files start)
    this.fileBoundaries = fileNames.map(([, index]) => index).filter(i => i > 0);
  }

  /**
   * Calculate merge groups based on settings and file boundaries
   */
  calculateMergeGroups(
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
      // Check if we've hit a file boundary
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

    // Build merge groups
    let groupStart = 0;
    let countInGroup = 0;
    let mergeNumber = 1;
    let lastFilename = indexToFilename.get(0) ?? 'audio';

    for (let i = 0; i < totalSentences; i++) {
      const currentFile = indexToFilename.get(i) ?? 'audio';
      const isFileBoundary = currentFile !== lastFilename;
      const isLastItem = i === totalSentences - 1;
      const hitMergeLimit = countInGroup >= this.mergeCount - 1;

      if (isFileBoundary || isLastItem || hitMergeLimit) {
        // Close current group
        const toIndex = isFileBoundary ? i - 1 : i;

        if (toIndex >= groupStart) {
          groups.push({
            fromIndex: groupStart,
            toIndex: toIndex,
            filename: lastFilename,
            mergeNumber: mergeNumber,
          });
        }

        // Start new group
        if (isFileBoundary) {
          groupStart = i;
          mergeNumber = 1;
          lastFilename = currentFile;
          countInGroup = 0;
        } else if (!isLastItem) {
          groupStart = i + 1;
          mergeNumber++;
          countInGroup = 0;
        }
      } else {
        countInGroup++;
      }
    }

    return groups;
  }

  /**
   * Merge audio data for a group
   */
  mergeAudioGroup(
    audioMap: Map<number, Uint8Array>,
    group: MergeGroup,
    totalGroups: number
  ): MergedFile | null {
    // Calculate total size
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

    // Generate filename
    let filename: string;
    if (this.mergeCount === Infinity || totalGroups === 1) {
      // Merge all - just use filename
      filename = `${group.filename}.mp3`;
    } else {
      // Multiple parts - include part number
      const paddedNum = String(group.mergeNumber).padStart(4, '0');
      filename = `${group.filename} ${paddedNum}.mp3`;
    }

    return {
      filename,
      blob: new Blob([combined.buffer], { type: 'audio/mpeg' }),
      fromIndex: group.fromIndex,
      toIndex: group.toIndex,
    };
  }

  /**
   * Merge all completed audio
   */
  merge(
    audioMap: Map<number, Uint8Array>,
    totalSentences: number,
    fileNames: Array<[string, number]>
  ): MergedFile[] {
    const groups = this.calculateMergeGroups(totalSentences, fileNames);
    const results: MergedFile[] = [];

    for (const group of groups) {
      const merged = this.mergeAudioGroup(audioMap, group, groups.length);
      if (merged) {
        results.push(merged);
      }
    }

    return results;
  }

  /**
   * Save merged files to directory (no download fallback)
   */
  async saveMergedFiles(
    files: MergedFile[],
    directoryHandle?: FileSystemDirectoryHandle | null
  ): Promise<void> {
    // Directory handle is REQUIRED - no fallback to downloads
    if (!directoryHandle) {
      throw new Error('Directory handle required. Please select a save folder.');
    }

    // Verify directory handle permissions
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
    const folderName = file.filename.replace(/\s+\d{4}\.mp3$/, '').replace(/\.mp3$/, '');

    const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await folderHandle.getFileHandle(file.filename, { create: true });
    const writableStream = await fileHandle.createWritable();
    await writableStream.write(file.blob);
    await writableStream.close();
  }
}
