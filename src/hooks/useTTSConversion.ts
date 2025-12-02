// useTTSConversion - Custom hook orchestrating the full TTS conversion workflow

import { useCallback, useRef } from 'preact/hooks';
import { TTSWorkerPool, PoolTask } from '../services/TTSWorkerPool';
import { AudioMerger } from '../services/AudioMerger';
import { LLMVoiceService } from '../services/LLMVoiceService';
import { TextBlockSplitter } from '../services/TextBlockSplitter';
import { VoiceAssigner } from '../services/VoiceAssigner';
import type { TTSConfig, ProcessedBook, SpeakerAssignment } from '../state/types';
import {
  voice,
  narratorVoice,
  rate,
  pitch,
  maxThreads,
  mergeFiles,
  dictionary,
  lexxRegister,
  isProcessing,
  processedCount,
  totalCount,
  addStatusLine,
  clearStatus,
  savePathHandle,
  // LLM state
  llmApiKey,
  llmApiUrl,
  llmModel,
  llmProcessingStatus,
  llmCurrentBlock,
  llmTotalBlocks,
  llmError,
  detectedCharacters,
  characterVoiceMap,
  resetLLMState,
  isLLMConfigured,
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
  // Store text and fileNames between Pass 1 and Pass 2 using refs
  const pendingTextRef = useRef<string>('');
  const pendingFileNamesRef = useRef<Array<[string, number]>>([]);

  /**
   * Start conversion - handles both LLM and non-LLM modes
   */
  const startConversion = useCallback(async (text: string, existingBook?: ProcessedBook | null) => {
    if (isProcessing.value) {
      addStatusLine('Conversion already in progress');
      return;
    }

    if (!text.trim()) {
      addStatusLine('No text to convert');
      return;
    }

    // Check LLM mode - LLM is required for conversion
    if (!isLLMConfigured()) {
      addStatusLine('❌ LLM not configured. Please set API key in settings.');
      llmError.value = 'LLM not configured';
      return;
    }

    // Start LLM-based conversion (Pass 1)
    await startLLMConversion(text, existingBook);
  }, []);

  /**
   * LLM-based conversion: Pass 1 (Character Extraction)
   */
  const startLLMConversion = async (text: string, existingBook?: ProcessedBook | null) => {
    clearStatus();
    isProcessing.value = true;
    resetLLMState();
    llmProcessingStatus.value = 'pass1';

    pendingTextRef.current = text;
    pendingFileNamesRef.current = existingBook?.fileNames ?? [[extractFilename(text), 0]];

    try {
      addStatusLine('🤖 Starting LLM character extraction (Pass 1)...');

      const llmService = new LLMVoiceService({
        apiKey: llmApiKey.value,
        apiUrl: llmApiUrl.value,
        model: llmModel.value,
        narratorVoice: narratorVoice.value,
      });

      const splitter = new TextBlockSplitter();
      const blocks = splitter.createPass1Blocks(text);
      llmTotalBlocks.value = blocks.length;

      addStatusLine(`Processing ${blocks.length} block(s)...`);

      const characters = await llmService.extractCharacters(blocks, (current, total) => {
        llmCurrentBlock.value = current;
        addStatusLine(`Pass 1: Block ${current}/${total}`);
      });

      detectedCharacters.value = characters;

      // Assign voices using VoiceAssigner
      const assigner = VoiceAssigner.createWithFilteredPool(narratorVoice.value);
      const voiceMap = assigner.assignVoicesFromLLMCharacters(characters);
      characterVoiceMap.value = voiceMap;

      addStatusLine(`✅ Detected ${characters.length} character(s)`);
      for (const char of characters) {
        const voice = voiceMap.get(char.canonicalName);
        addStatusLine(`  - ${char.canonicalName} (${char.gender}): ${voice}`);
      }

      // Auto-continue to Pass 2 (no manual review step)
      addStatusLine('🤖 Starting LLM speaker assignment (Pass 2)...');
      llmProcessingStatus.value = 'pass2';

      const pass2Blocks = splitter.createPass2Blocks(text);
      llmTotalBlocks.value = pass2Blocks.length;

      const assignments = await llmService.assignSpeakers(
        pass2Blocks,
        characterVoiceMap.value,
        (current, total) => {
          llmCurrentBlock.value = current;
          addStatusLine(`Pass 2: Block ${current}/${total}`);
        }
      );

      addStatusLine(`✅ Assigned speakers to ${assignments.length} sentence(s)`);

      // Apply dictionary processing to assignments
      const processedAssignments = applyDictionaryToAssignments(assignments);

      // Convert to chunks and run TTS
      await runTTSConversion(processedAssignments, pendingFileNamesRef.current);

      llmProcessingStatus.value = 'idle';

    } catch (err) {
      const errorMsg = (err as Error).message;
      addStatusLine(`❌ Pass 1 error: ${errorMsg}`);
      llmError.value = errorMsg;
      llmProcessingStatus.value = 'error';
      isProcessing.value = false;
    }
  };

  /**
   * Cancel LLM processing
   */
  const cancelLLMProcessing = useCallback(() => {
    resetLLMState();
    isProcessing.value = false;
    addStatusLine('Cancelled');
  }, []);

  /**
   * Apply dictionary rules to speaker assignments
   */
  const applyDictionaryToAssignments = (assignments: SpeakerAssignment[]): SpeakerAssignment[] => {
    if (dictionary.value.length === 0) {
      return assignments;
    }

    return assignments.map((a) => ({
      ...a,
      text: applyDictionaryRules(a.text),
    }));
  };

  /**
   * Apply dictionary rules to a single text
   */
  const applyDictionaryRules = (text: string): string => {
    let result = text;

    // Sanitize
    result = result.replace(/[~|*^]/g, '-');
    result = result.replace(/\\/g, '/');
    result = result.replace(/&/g, ' and ');
    result = result.replace(/</g, '(');
    result = result.replace(/>/g, ')');

    // Apply rules
    for (const rule of dictionary.value) {
      const regexMatch = rule.match(/^regex"(.*)"="(.*)"/);
      if (regexMatch) {
        const regex = new RegExp(regexMatch[1], 'g');
        const replacement = regexMatch[2].replace(/\\r/g, '\r').replace(/\\n/g, '\n');
        result = result.replace(regex, replacement);
      } else if (rule.length > 0) {
        if (rule[0] === '"') {
          const matchArr = rule.trim().replaceAll('"', '').split('=');
          if (matchArr.length === 2) {
            if (lexxRegister.value) {
              result = result.replaceAll(matchArr[0], matchArr[1]);
            } else {
              const regex = new RegExp(escapeRegex(matchArr[0]), 'giu');
              result = result.replace(regex, matchArr[1]);
            }
          }
        } else {
          const matchArr = rule.trim().split('=');
          if (matchArr.length === 2) {
            const escaped = escapeRegex(matchArr[0]);
            const regex = new RegExp(`(^|\\s|\\p{P})${escaped}(?=\\p{P}|\\s|$)`, 'giu');
            result = result.replace(regex, `$1${matchArr[1]}`);
          }
        }
      }
    }

    return result;
  };

  /**
   * Run TTS conversion with speaker assignments
   */
  const runTTSConversion = async (
    assignments: SpeakerAssignment[],
    fileNames: Array<[string, number]>
  ) => {
    const chunks = assignments
      .filter((a) => /[\p{L}\p{N}]/u.test(a.text))
      .map((a, index) => ({
        text: a.text,
        voice: a.voiceId,
        partIndex: index,
        speaker: a.speaker,
      }));

    if (chunks.length === 0) {
      addStatusLine('No sentences to convert after processing');
      isProcessing.value = false;
      return;
    }

    totalCount.value = chunks.length;
    addStatusLine(`Converting ${chunks.length} chunks to audio...`);

    const config = buildTTSConfig();
    const audioMap = new Map<number, Uint8Array>();

    const pool = new TTSWorkerPool({
      maxWorkers: maxThreads.value,
      config: config,
      saveToDir: null,
      onStatusUpdate: (update) => {
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
        addStatusLine('Merging audio files...');

        try {
          const merger = new AudioMerger(mergeFiles.value);
          const mergedFiles = merger.merge(audioMap, chunks.length, fileNames);

          if (mergedFiles.length === 0) {
            addStatusLine('No audio files to merge');
            isProcessing.value = false;
            return;
          }

          addStatusLine(`Saving ${mergedFiles.length} merged file(s)...`);
          await merger.saveMergedFiles(mergedFiles, savePathHandle.value);

          const failedCount = pool.getFailedTasks().size;
          if (failedCount > 0) {
            addStatusLine(`✅ Complete! (${failedCount} chunks failed)`);
          } else {
            addStatusLine('✅ Complete!');
          }
        } catch (err) {
          addStatusLine(`Merge error: ${(err as Error).message}`);
        }

        isProcessing.value = false;
      },
    });

    const tasks: PoolTask[] = chunks.map((chunk) => {
      let filename = fileNames[0]?.[0] ?? 'audio';
      for (const [name, boundaryIndex] of fileNames) {
        if (chunk.partIndex >= boundaryIndex && boundaryIndex > 0) {
          filename = name;
        }
      }

      return {
        partIndex: chunk.partIndex,
        text: chunk.text,
        filename: filename,
        filenum: String(chunk.partIndex + 1).padStart(4, '0'),
        voice: chunk.voice,
      };
    });

    pool.addTasks(tasks);
  };

  const selectDirectory = useCallback(async (): Promise<boolean> => {
    // If already have a handle, verify it's still valid and reuse
    if (savePathHandle.value) {
      try {
        const permission = await savePathHandle.value.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          addStatusLine(`Saving to: ${savePathHandle.value.name}`);
          return true;
        }
      } catch {
        savePathHandle.value = null;
      }
    }

    // Require directory picker - no fallback to downloads
    if (!window.showDirectoryPicker) {
      addStatusLine('❌ Directory picker not supported. Please use Chrome, Edge, or Opera.');
      return false;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      savePathHandle.value = handle;
      addStatusLine(`Saving to: ${handle.name}`);
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        addStatusLine('❌ Directory selection required. Please select a folder to save files.');
      } else {
        addStatusLine(`❌ Directory selection failed: ${(err as Error).message}`);
      }
      return false;
    }
  }, []);

  return {
    startConversion,
    cancelLLMProcessing,
    selectDirectory,
    isProcessing: isProcessing.value,
    progress: {
      current: processedCount.value,
      total: totalCount.value,
    },
  };
}

/**
 * Helper: escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
