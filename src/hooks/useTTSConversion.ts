// useTTSConversion - Simplified hook using runConversion function
// Orchestrator is now a plain function with external AbortSignal

import { useCallback, useRef } from 'preact/hooks';
import { getOrchestratorServices } from '@/services';
import { type OrchestratorInput, runConversion } from '@/services/ConversionOrchestrator';
import { getKeepAwake } from '@/services/KeepAwake';
import type { ProcessedBook } from '@/state/types';
import type { Stores } from '@/stores';
import { useStores } from '@/stores';
import { isProcessing, progress, setError } from '@/stores/ConversionStore';
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
    extractConfig: {
      apiKey: l.extract.apiKey,
      apiUrl: l.extract.apiUrl,
      model: l.extract.model,
      streaming: l.extract.streaming,
      reasoning: l.extract.reasoning ?? undefined,
      temperature: l.extract.temperature,
      topP: l.extract.topP,
      repeatPrompt: l.extract.repeatPrompt,
    },
    mergeConfig: {
      apiKey: l.merge.apiKey,
      apiUrl: l.merge.apiUrl,
      model: l.merge.model,
      streaming: l.merge.streaming,
      reasoning: l.merge.reasoning ?? undefined,
      temperature: l.merge.temperature,
      topP: l.merge.topP,
      repeatPrompt: l.merge.repeatPrompt,
    },
    assignConfig: {
      apiKey: l.assign.apiKey,
      apiUrl: l.assign.apiUrl,
      model: l.assign.model,
      streaming: l.assign.streaming,
      reasoning: l.assign.reasoning ?? undefined,
      temperature: l.assign.temperature,
      topP: l.assign.topP,
      repeatPrompt: l.assign.repeatPrompt,
    },
    useVoting: l.useVoting,

    narratorVoice: s.narratorVoice,
    voice: s.voice,
    pitch: s.pitch,
    rate: s.rate,
    ttsThreads: s.ttsThreads,
    llmThreads: s.llmThreads,
    enabledVoices: s.enabledVoices,
    lexxRegister: s.lexxRegister,
    outputFormat: s.outputFormat,
    silenceRemoval: s.silenceRemovalEnabled,
    normalization: s.normalizationEnabled,
    deEss: s.deEssEnabled,
    silenceGapMs: s.silenceGapMs,
    eq: s.eqEnabled,
    compressor: s.compressorEnabled,
    fadeIn: s.fadeInEnabled,
    stereoWidth: s.stereoWidthEnabled,
    opusMinBitrate: s.opusMinBitrate,
    opusMaxBitrate: s.opusMaxBitrate,
    opusCompressionLevel: s.opusCompressionLevel,

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

      // Build input snapshot from current store state
      const input = buildInput(stores, text);

      // Create abort controller for this conversion
      abortControllerRef.current = new AbortController();

      // Get orchestrator services bundle
      const orchestratorServices = getOrchestratorServices();

      // Start keep-awake to prevent background throttling
      const keepAwake = getKeepAwake();
      await keepAwake.start();

      try {
        await runConversion(
          orchestratorServices,
          stores,
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
