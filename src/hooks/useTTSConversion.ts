// useTTSConversion - Simplified hook using ConversionOrchestrator
// This is the adapter layer between Preact stores and the decoupled orchestrator

import { useCallback, useRef } from 'preact/hooks';
import { useServices } from '@/di';
import { useStores } from '@/stores';
import type { Stores } from '@/stores';
import { ConversionOrchestrator } from '@/services/ConversionOrchestrator';
import type { OrchestratorInput, OrchestratorCallbacks } from '@/services/OrchestratorCallbacks';
import type { ConversionStatus } from '@/stores/ConversionStore';
import { getKeepAwake } from '@/services/KeepAwake';
import type { ProcessedBook } from '@/state/types';

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
 * Build OrchestratorInput snapshot from stores
 */
function buildInput(stores: Stores, text: string): OrchestratorInput {
  return {
    isLLMConfigured: stores.llm.isConfigured.value,
    extractConfig: {
      apiKey: stores.llm.extract.value.apiKey,
      apiUrl: stores.llm.extract.value.apiUrl,
      model: stores.llm.extract.value.model,
      streaming: stores.llm.extract.value.streaming,
      reasoning: stores.llm.extract.value.reasoning ?? undefined,
      temperature: stores.llm.extract.value.temperature,
      topP: stores.llm.extract.value.topP,
    },
    mergeConfig: {
      apiKey: stores.llm.merge.value.apiKey,
      apiUrl: stores.llm.merge.value.apiUrl,
      model: stores.llm.merge.value.model,
      streaming: stores.llm.merge.value.streaming,
      reasoning: stores.llm.merge.value.reasoning ?? undefined,
      temperature: stores.llm.merge.value.temperature,
      topP: stores.llm.merge.value.topP,
    },
    assignConfig: {
      apiKey: stores.llm.assign.value.apiKey,
      apiUrl: stores.llm.assign.value.apiUrl,
      model: stores.llm.assign.value.model,
      streaming: stores.llm.assign.value.streaming,
      reasoning: stores.llm.assign.value.reasoning ?? undefined,
      temperature: stores.llm.assign.value.temperature,
      topP: stores.llm.assign.value.topP,
    },
    useVoting: stores.llm.useVoting.value,

    narratorVoice: stores.settings.narratorVoice.value,
    voice: stores.settings.voice.value,
    pitch: stores.settings.pitch.value,
    rate: stores.settings.rate.value,
    ttsThreads: stores.settings.ttsThreads.value,
    llmThreads: stores.settings.llmThreads.value,
    enabledVoices: stores.settings.enabledVoices.value,
    lexxRegister: stores.settings.lexxRegister.value,
    outputFormat: stores.settings.outputFormat.value,
    silenceRemoval: stores.settings.silenceRemovalEnabled.value,
    normalization: stores.settings.normalizationEnabled.value,
    deEss: stores.settings.deEssEnabled.value,
    silenceGapMs: stores.settings.silenceGapMs.value,
    eq: stores.settings.eqEnabled.value,
    compressor: stores.settings.compressorEnabled.value,
    fadeIn: stores.settings.fadeInEnabled.value,
    stereoWidth: stores.settings.stereoWidthEnabled.value,
    opusMinBitrate: stores.settings.opusMinBitrate.value,
    opusMaxBitrate: stores.settings.opusMaxBitrate.value,
    opusCompressionLevel: stores.settings.opusCompressionLevel.value,

    directoryHandle: stores.data.directoryHandle.value,
    detectedLanguage: stores.data.detectLanguageFromContent(),
    dictionaryRaw: stores.data.dictionaryRaw.value,
    textContent: text,
  };
}

/**
 * Build OrchestratorCallbacks that delegate to stores
 */
function buildCallbacks(stores: Stores): OrchestratorCallbacks {
  return {
    onConversionStart: () => stores.conversion.startConversion(),
    onConversionComplete: () => stores.conversion.complete(),
    onConversionCancel: () => stores.conversion.cancel(),
    onError: (message: string, code: string) => stores.conversion.setError(message, code),
    onProgress: () => {}, // Progress is handled via specific callbacks below
    onStatusChange: (status: ConversionStatus) => stores.conversion.setStatus(status),
    onConversionProgress: (current: number, total: number) => stores.conversion.updateProgress(current, total),
    onLLMProcessingStatus: (status: string) => stores.llm.setProcessingStatus(status as any),
    onLLMBlockProgress: (current: number, total: number) => stores.llm.setBlockProgress(current, total),

    awaitResumeConfirmation: (info) => stores.conversion.awaitResumeConfirmation(info),

    onCharactersReady: (characters) => stores.llm.setCharacters(characters),
    onVoiceMapReady: (voiceMap) => stores.llm.setVoiceMap(voiceMap),
    onAssignmentsReady: (assignments) => stores.llm.setSpeakerAssignments(assignments),
    awaitVoiceReview: async () => {
      stores.llm.setPendingReview(true);
      await stores.llm.awaitReview();
      return {
        voiceMap: stores.llm.characterVoiceMap.value,
        existingProfile: stores.llm.loadedProfile.value,
      };
    },

    clearTextContent: () => stores.data.setTextContent(''),
    clearBook: () => stores.data.setBook(null),
    startTimer: () => stores.logs.startTimer(),
    resetLLMState: () => stores.llm.resetProcessingState(),
    setLLMError: (message: string) => stores.llm.setError(message),
  };
}

/**
 * Main TTS conversion hook
 * Uses ConversionOrchestrator for the actual conversion workflow
 */
export function useTTSConversion(): UseTTSConversionResult {
  const container = useServices();
  const stores = useStores();
  const orchestratorRef = useRef<ConversionOrchestrator | null>(null);

  /**
   * Start conversion
   */
  const startConversion = useCallback(async (
    text: string,
    existingBook?: ProcessedBook | null
  ) => {
    // Check if already processing
    if (stores.conversion.isProcessing.value) {
      stores.logs.info('Conversion already in progress');
      return;
    }

    // Build callbacks and input snapshot from current store state
    const callbacks = buildCallbacks(stores);
    const input = buildInput(stores, text);

    // Create new orchestrator
    orchestratorRef.current = new ConversionOrchestrator(container, callbacks);

    // Start keep-awake to prevent background throttling
    const keepAwake = getKeepAwake();
    await keepAwake.start();

    try {
      await orchestratorRef.current.run(input, existingBook);
    } catch (error) {
      // Error is already logged by orchestrator
      // Just ensure we're not in processing state
      if (stores.conversion.isProcessing.value) {
        stores.conversion.setError((error as Error).message);
      }
    } finally {
      // Stop keep-awake when conversion ends
      keepAwake.stop();
    }
  }, [container, stores]);

  /**
   * Cancel conversion
   */
  const cancel = useCallback(() => {
    orchestratorRef.current?.cancel();
    stores.logs.info('Conversion cancelled');
  }, [stores]);

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
  }, [stores]);

  return {
    startConversion,
    cancel,
    selectDirectory,
    isProcessing: stores.conversion.isProcessing.value,
    progress: {
      current: stores.conversion.progress.value.current,
      total: stores.conversion.progress.value.total,
    },
  };
}
