// useTTSConversion - Custom hook orchestrating the full TTS conversion workflow

import { useCallback } from 'preact/hooks';
import { TextProcessor, ProcessedBookWithVoices } from '../services/TextProcessor';
import { TTSWorkerPool, PoolTask } from '../services/TTSWorkerPool';
import { AudioMerger } from '../services/AudioMerger';
import type { TTSConfig, ProcessedBook } from '../state/types';
import {
  voice,
  narratorVoice,
  voicePoolLocale,
  rate,
  pitch,
  maxThreads,
  mergeFiles,
  dictionary,
  pointsSelect,
  pointsType,
  lexxRegister,
  isProcessing,
  processedCount,
  totalCount,
  addStatusLine,
  clearStatus,
  savePathHandle,
} from '../state/appState';

export type ConversionStatus = 'idle' | 'processing' | 'merging' | 'complete' | 'error';

/**
 * Build TTSConfig from current signal values
 */
function buildTTSConfig(): TTSConfig {
  return {
    voice: `Microsoft Server Speech Text to Speech Voice (${voice.value})`,
    pitch: pitch.value >= 0 ? `+${pitch.value}Hz` : `${pitch.value}Hz`,
    rate: rate.value >= 0 ? `+${rate.value}%` : `${rate.value}%`,
    volume: '+0%',
  };
}

/**
 * Extract filename from text or use default
 */
function extractFilename(text: string): string {
  // Try to get first non-empty line as filename
  const firstLine = text.split('\n').find(line => line.trim().length > 0);
  if (firstLine) {
    // Clean up for use as filename
    const cleaned = firstLine.trim().slice(0, 50).replace(/[<>:"/\\|?*]/g, '_');
    return cleaned || 'audio';
  }
  return 'audio';
}

export function useTTSConversion() {
  const startConversion = useCallback(async (text: string, existingBook?: ProcessedBook | null) => {
    if (isProcessing.value) {
      addStatusLine('Conversion already in progress');
      return;
    }

    if (!text.trim()) {
      addStatusLine('No text to convert');
      return;
    }

    // Reset state
    clearStatus();
    isProcessing.value = true;

    try {
      // Step 1: Process text with multi-voice support
      addStatusLine('Processing text and detecting dialogue...');

      let processedBook: ProcessedBookWithVoices;

      if (existingBook && existingBook.allSentences.length > 0) {
        // Use existing book but wrap it for compatibility
        processedBook = {
          ...existingBook,
          chunks: existingBook.allSentences.map((text, index) => ({
            text,
            voice: narratorVoice.value,
            partIndex: index,
            speaker: 'narrator',
          })),
          characters: new Map(),
          voiceAssignments: new Map(),
        };
      } else {
        const processor = new TextProcessor({
          fileName: extractFilename(text),
          text: text,
          dictionary: dictionary.value,
          caseSensitive: lexxRegister.value,
          pointsSelect: pointsSelect.value,
          pointsType: pointsType.value,
          narratorVoice: narratorVoice.value,
          voicePoolLocale: voicePoolLocale.value,
        });
        processedBook = processor.processWithVoices();
      }

      if (processedBook.chunks.length === 0) {
        addStatusLine('No sentences to convert after processing');
        isProcessing.value = false;
        return;
      }

      // Log detected characters
      if (processedBook.characters.size > 0) {
        addStatusLine(`Detected ${processedBook.characters.size} character(s): ${Array.from(processedBook.characters.keys()).join(', ')}`);
      }

      totalCount.value = processedBook.chunks.length;
      addStatusLine(`Found ${processedBook.chunks.length} chunks to convert`);

      // Step 2: Create worker pool
      const config = buildTTSConfig();
      const audioMap = new Map<number, Uint8Array>();

      const pool = new TTSWorkerPool({
        maxWorkers: maxThreads.value,
        config: config,
        saveToDir: null, // Don't save individual - we'll merge
        onStatusUpdate: (update) => {
          // Update status display
          addStatusLine(update.message);
        },
        onTaskComplete: (partIndex, audioData) => {
          audioMap.set(partIndex, audioData);
          processedCount.value++;
        },
        onTaskError: (partIndex, error) => {
          addStatusLine(`Part ${partIndex + 1} failed: ${error.message}`);
          processedCount.value++;
        },
        onAllComplete: async () => {
          // Step 3: Merge audio
          addStatusLine('Merging audio files...');

          try {
            const merger = new AudioMerger(mergeFiles.value);
            const mergedFiles = merger.merge(
              audioMap,
              processedBook.chunks.length,
              processedBook.fileNames
            );

            if (mergedFiles.length === 0) {
              addStatusLine('No audio files to merge');
              isProcessing.value = false;
              return;
            }

            addStatusLine(`Saving ${mergedFiles.length} merged file(s)...`);

            await merger.saveMergedFiles(mergedFiles, savePathHandle.value);

            const failedCount = pool.getFailedTasks().size;
            if (failedCount > 0) {
              addStatusLine(`Complete! (${failedCount} chunks failed)`);
            } else {
              addStatusLine('Complete!');
            }
          } catch (err) {
            addStatusLine(`Merge error: ${(err as Error).message}`);
          }

          isProcessing.value = false;
        },
      });

      // Step 4: Queue all tasks with voice information
      const tasks: PoolTask[] = processedBook.chunks.map((chunk) => {
        // Determine which file this chunk belongs to
        let filename = processedBook.fileNames[0]?.[0] ?? 'audio';
        for (const [name, boundaryIndex] of processedBook.fileNames) {
          if (chunk.partIndex >= boundaryIndex && boundaryIndex > 0) {
            filename = name;
          }
        }

        return {
          partIndex: chunk.partIndex,
          text: chunk.text,
          filename: filename,
          filenum: String(chunk.partIndex + 1).padStart(4, '0'),
          voice: chunk.voice, // Include voice for multi-voice support
        };
      });

      pool.addTasks(tasks);

    } catch (err) {
      addStatusLine(`Error: ${(err as Error).message}`);
      isProcessing.value = false;
    }
  }, []);

  const selectDirectory = useCallback(async (): Promise<boolean> => {
    if (!window.showDirectoryPicker) {
      addStatusLine('Directory picker not supported - will download files');
      return true;
    }

    try {
      const handle = await window.showDirectoryPicker();
      savePathHandle.value = handle;
      addStatusLine(`Saving to: ${handle.name}`);
      return true;
    } catch (err) {
      // User cancelled or error
      if ((err as Error).name !== 'AbortError') {
        addStatusLine('Directory selection cancelled - will download files');
      }
      return true; // Continue with download fallback
    }
  }, []);

  return {
    startConversion,
    selectDirectory,
    isProcessing: isProcessing.value,
    progress: {
      current: processedCount.value,
      total: totalCount.value,
    },
  };
}
