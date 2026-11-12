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
import { isConfigured, llm, poolEntries, poolError } from '@/stores/LLMStore';
import { settings } from '@/stores/SettingsStore';
import { selectOutputDirectory } from '@/utils/directoryPicker';

export interface UseTTSConversionResult {
  startConversion: (text: string, existingBook?: ProcessedBook | null) => Promise<void>;
  cancel: () => void;
  selectDirectory: () => Promise<boolean>;
  isProcessing: boolean;
  progress: {
    current: number;
    total: number;
  };
}

function buildInput(stores: Stores, text: string): OrchestratorInput {
  const s = settings.value;
  const l = llm.value;
  return {
    isLLMConfigured: isConfigured.value,
    extractConfig: { ...l.extract },
    mergeConfig: { ...l.merge },
    assignConfig: { ...l.assign },
    backupConfig: { ...l.backup },
    pool: poolEntries.value,
    useVoting: l.useVoting,

    narratorVoice: s.narratorVoice,
    pitch: s.pitch,
    rate: s.rate,
    ttsThreads: s.ttsThreads,
    llmThreads: s.llmThreads,
    enabledVoices: s.enabledVoices,
    lexxRegister: s.lexxRegister,
    outputFormat: s.outputFormat,
    audio: { ...s.audio },

    directoryHandle: stores.data.directoryHandle.value,
    detectedLanguage: stores.data.detectLanguageFromContent().language,
    dictionaryRaw: stores.data.dictionaryRaw.value,
    textContent: text,
  };
}

export function useTTSConversion(): UseTTSConversionResult {
  const stores = useStores();
  const abortControllerRef = useRef<AbortController | null>(null);

  const startConversion = useCallback(
    async (text: string, existingBook?: ProcessedBook | null) => {
      if (isProcessing.value) {
        stores.logs.info('Conversion already in progress');
        return;
      }

      const blocked = await KeepAwake.isConversionRunning();
      if (blocked) {
        patchState({ tabBlocked: true, status: 'idle' });
        return;
      }

      patchState({ tabBlocked: false });

      // An invalid Connection pool fails before any work starts: falling
      // through with no entries would send requests on an empty stage key.
      const poolFailure = poolError.value;
      if (poolFailure) {
        const message = `Connection pool is invalid: ${poolFailure}. Fix the Pool tab before converting.`;
        stores.conversion.setError(message, 'LLM_POOL_INVALID');
        stores.llm.setError(message);
        stores.logs.error(message);
        return;
      }

      const input = buildInput(stores, text);

      abortControllerRef.current = new AbortController();

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

      // Hold a wake lock so the browser does not throttle the tab mid-Conversion.
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
        // The orchestrator already logged the error; this only exits the processing state.
        if (isProcessing.value) {
          setError((error as Error).message);
        }
      } finally {
        keepAwake.stop();
        abortControllerRef.current = null;
      }
    },
    [stores],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    stores.logs.info('Conversion cancelled');
  }, [stores.logs]);

  const selectDirectory = useCallback(async (): Promise<boolean> => {
    return selectOutputDirectory({
      isSecureContext: window.isSecureContext,
      // Web IDL methods need their receiver: an unbound reference throws
      // "Illegal invocation" when the helper calls it.
      showDirectoryPicker: window.showDirectoryPicker?.bind(window),
      getHandle: () => stores.data.directoryHandle.value,
      setHandle: (handle) => stores.data.setDirectoryHandle(handle),
      logInfo: (message) => stores.logs.info(message),
      logError: (message) => stores.logs.error(message),
    });
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
