// useTTSConversion - Simplified hook using runConversion function
// Orchestrator is now a plain function with external AbortSignal

import { useCallback, useRef } from 'preact/hooks';
import { getOrchestratorServices } from '@/services';
import {
  type ConversionPorts,
  type OrchestratorInput,
  runConversion,
} from '@/services/ConversionOrchestrator';
import { getKeepAwake, KeepAwake } from '@/services/KeepAwake';
import { type ProcessedBook, STAGE_STATUS } from '@/state/types';
import type { Stores } from '@/stores';
import { resumeGate, reviewGate, useStores } from '@/stores';
import {
  isProcessing,
  patchState,
  progress,
  setError,
  updateProgress,
} from '@/stores/ConversionStore';
import { isConfigured, llm } from '@/stores/LLMStore';
// Import signal-based stores directly for snapshot access
import { settings } from '@/stores/SettingsStore';

/**
 * Hook return type
 */
export interface UseTTSConversionResult {
  /** Start conversion with text and optional book metadata */
  startConversion: (text: string, existingBook?: ProcessedBook | null) => Promise<void>;
  /** Cancel ongoing conversion */
  cancel: () => void;
  /** Select directory for saving files */
  selectDirectory: () => Promise<boolean>;
  /** Whether conversion is in progress */
  isProcessing: boolean;
  /** Current progress */
  progress: {
    current: number;
    total: number;
  };
}

/**
 * Build OrchestratorInput snapshot from signal-based stores
 */
function buildInput(stores: Stores, text: string): OrchestratorInput {
  const s = settings.value;
  const l = llm.value;
  return {
    isLLMConfigured: isConfigured.value,
    extractConfig: { ...l.extract },
    mergeConfig: { ...l.merge },
    assignConfig: { ...l.assign },
    backupConfig: { ...l.backup },
    useVoting: l.useVoting,

    narratorVoice: s.narratorVoice,
    pitch: s.pitch,
    rate: s.rate,
    ttsThreads: s.ttsThreads,
    llmThreads: s.llmThreads,
    enabledVoices: s.enabledVoices,
    lexxRegister: s.lexxRegister,
    outputFormat: s.outputFormat,
    audio: {
      silenceRemoval: s.silenceRemovalEnabled,
      normalization: s.normalizationEnabled,
      deEss: s.deEssEnabled,
      silenceGapMs: s.silenceGapMs,
      eq: s.eqEnabled,
      compressor: s.compressorEnabled,
      fadeIn: s.fadeInEnabled,
      opusMinBitrate: s.opusMinBitrate,
      opusMaxBitrate: s.opusMaxBitrate,
      opusCompressionLevel: s.opusCompressionLevel,
      mergeConcurrency: s.mergeConcurrency,
    },

    directoryHandle: stores.data.directoryHandle.value,
    detectedLanguage: stores.data.detectLanguageFromContent().language,
    dictionaryRaw: stores.data.dictionaryRaw.value,
    textContent: text,
  };
}

/**
 * Main TTS conversion hook
 * Uses ConversionOrchestrator for the actual conversion workflow
 */
export function useTTSConversion(): UseTTSConversionResult {
  const stores = useStores();
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Start conversion
   */
  const startConversion = useCallback(
    async (text: string, existingBook?: ProcessedBook | null) => {
      // Check if already processing
      if (isProcessing.value) {
        stores.logs.info('Conversion already in progress');
        return;
      }

      // Check if conversion is running in another tab
      const blocked = await KeepAwake.isConversionRunning();
      if (blocked) {
        patchState({ tabBlocked: true, status: 'idle' });
        return;
      }

      // Clear any previous tab-blocked state
      patchState({ tabBlocked: false });

      // Build input snapshot from current store state
      const input = buildInput(stores, text);

      // Create abort controller for this conversion
      abortControllerRef.current = new AbortController();

      // Get orchestrator services bundle
      const orchestratorServices = getOrchestratorServices();

      // Adapters bridging the orchestrator ports to the signal-based stores.
      // STAGE_STATUS projects each stage id onto the conversion/LLM status
      // stores; null entries mean "leave untouched".
      const ports: ConversionPorts = {
        progress: {
          report: (stage, current, total, _message, failed = 0) => {
            const status = STAGE_STATUS[stage];
            if (status.conversion) stores.conversion.setStatus(status.conversion);
            if (status.llm) stores.llm.setProcessingStatus(status.llm);
            if (total > 0) updateProgress(current, total, failed);
          },
          setConcurrency: (llmCount, tts) => stores.conversion.setConcurrencyStats(llmCount, tts),
          setPhaseBaseline: (count) => stores.conversion.setPhaseBaseline(count),
        },
        review: {
          open: (characters, voiceMap, assignments) => {
            stores.llm.setProcessingStatus('review');
            return reviewGate.open({
              characters,
              voiceMap,
              assignments,
              profile: stores.llm.loadedProfile.value,
              lineCounts: stores.llm.characterLineCounts.value,
            });
          },
        },
        resume: {
          confirm: (info) => resumeGate.open(info),
        },
        run: {
          begin: () => {
            stores.conversion.startConversion();
            stores.logs.startTimer();
            stores.llm.resetProcessingState();
            stores.data.setTextContent('');
            stores.data.setBook(null);
          },
          complete: () => stores.conversion.complete(),
          cancel: () => stores.conversion.cancel(),
          fail: (message, code) => {
            stores.conversion.setError(message, code);
            stores.llm.setError(message);
          },
        },
        characters: {
          push: (characters, voiceMap, assignments) => {
            stores.llm.setCharacters(characters);
            stores.llm.setVoiceMap(voiceMap);
            stores.llm.setSpeakerAssignments(assignments);
          },
        },
      };

      // Start keep-awake to prevent background throttling
      const keepAwake = getKeepAwake();
      await keepAwake.start();

      try {
        await runConversion(
          orchestratorServices,
          ports,
          abortControllerRef.current.signal,
          input,
          existingBook,
        );
      } catch (error) {
        // Error is already logged by orchestrator
        // Just ensure we're not in processing state
        if (isProcessing.value) {
          setError((error as Error).message);
        }
      } finally {
        // Stop keep-awake when conversion ends
        keepAwake.stop();
        abortControllerRef.current = null;
      }
    },
    [stores],
  );

  /**
   * Cancel conversion
   */
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    stores.logs.info('Conversion cancelled');
  }, [stores.logs]);

  /**
   * Select directory for saving files
   */
  const selectDirectory = useCallback(async (): Promise<boolean> => {
    const currentHandle = stores.data.directoryHandle.value;

    // If already have a handle, verify it's still valid
    if (currentHandle) {
      try {
        const permission = await currentHandle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          stores.logs.info(`Saving to: ${currentHandle.name}`);
          return true;
        }
      } catch {
        stores.data.setDirectoryHandle(null);
      }
    }

    // Check for directory picker support
    if (!window.showDirectoryPicker) {
      stores.logs.error('Directory picker not supported. Please use Chrome, Edge, or Opera.');
      return false;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      stores.data.setDirectoryHandle(handle);
      stores.logs.info(`Saving to: ${handle.name}`);
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        stores.logs.error('Directory selection required. Please select a folder to save files.');
      } else {
        stores.logs.error(`Directory selection failed: ${(err as Error).message}`);
      }
      return false;
    }
  }, [stores.data, stores.logs]);

  return {
    startConversion,
    cancel,
    selectDirectory,
    isProcessing: isProcessing.value,
    progress: {
      current: progress.value.current,
      total: progress.value.total,
    },
  };
}
