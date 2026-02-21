// useTTSConversion - Simplified hook using ConversionOrchestrator
// Directly passes stores to the orchestrator instead of using callback middleware

import { useCallback, useRef } from 'preact/hooks';
import { useStores } from '@/stores';
import type { Stores } from '@/stores';
import { createConversionOrchestrator, type OrchestratorInput } from '@/services/ConversionOrchestrator';
import { getOrchestratorServices } from '@/services';
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
 * Main TTS conversion hook
 * Uses ConversionOrchestrator for the actual conversion workflow
 */
export function useTTSConversion(): UseTTSConversionResult {
  const stores = useStores();
  const orchestratorRef = useRef<{ run: (input: OrchestratorInput, existingBook?: ProcessedBook | null) => Promise<void>; cancel: () => void } | null>(null);

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

    // Build input snapshot from current store state
    const input = buildInput(stores, text);

    // Get orchestrator services bundle and create new orchestrator
    const orchestratorServices = getOrchestratorServices();
    orchestratorRef.current = createConversionOrchestrator(orchestratorServices, stores);

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
  }, [stores]);

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
