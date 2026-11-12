import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';
import type { LoggerStore } from '@/services/Logger';
import { decryptValue, encryptValue } from '@/services/SecureStorage';
import { saveJSON } from './persistence';
import { parsePoolTextarea, PoolParseError, type PoolEntry } from '@/services/llm/pool';
import type { LLMCharacter, SpeakerAssignment, StageConfig, VoiceProfileFile } from '@/state/types';

// ============================================================================
// Types
// ============================================================================

export type LLMProcessingStatus = 'idle' | 'extracting' | 'review' | 'assigning' | 'error';
export type LLMStage = 'extract' | 'merge' | 'assign' | 'backup';

interface LLMSettings {
  useVoting: boolean;
  extract: StageConfig;
  merge: StageConfig;
  assign: StageConfig;
  backup: StageConfig;
}

interface LLMState {
  // Settings (persisted)
  useVoting: boolean;
  extract: StageConfig;
  merge: StageConfig;
  assign: StageConfig;
  backup: StageConfig;
  /** Connection pool textarea exactly as typed; encrypted as one blob on save. */
  poolRaw: string;

  // Processing state (not persisted)
  processingStatus: LLMProcessingStatus;
  currentBlock: number;
  totalBlocks: number;
  error: string | null;

  // Character data (not persisted)
  detectedCharacters: LLMCharacter[];
  characterVoiceMap: Map<string, string>;
  speakerAssignments: SpeakerAssignment[];
  loadedProfile: VoiceProfileFile | null;
}

// ============================================================================
// Defaults
// ============================================================================

const defaultStageConfig: StageConfig = {
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  streaming: true,
  reasoning: null,
  temperature: 0.0,
  topP: 0.95,
  repeatPrompt: false,
  corsMiddleware: '',
  maxRetries: 3,
};

const defaultPersistedState: LLMSettings & Pick<LLMState, 'poolRaw'> = {
  useVoting: false,
  extract: { ...defaultStageConfig },
  merge: { ...defaultStageConfig },
  assign: { ...defaultStageConfig },
  backup: { ...defaultStageConfig },
  poolRaw: '',
};

const defaultTransientState = {
  processingStatus: 'idle' as LLMProcessingStatus,
  currentBlock: 0,
  totalBlocks: 0,
  error: null,
  detectedCharacters: [],
  characterVoiceMap: new Map<string, string>(),
  speakerAssignments: [],
  loadedProfile: null,
};

// ============================================================================
// Store Definition
// ============================================================================

export const llm = signal<LLMState>({
  ...defaultPersistedState,
  ...defaultTransientState,
});

export const characterVoiceMap = computed(() => llm.value.characterVoiceMap);
export const loadedProfile = computed(() => llm.value.loadedProfile);

export const speakerAssignments = computed(() => llm.value.speakerAssignments);
export const processingStatus = computed(() => llm.value.processingStatus);
export const error = computed(() => llm.value.error);

export const extract = computed(() => llm.value.extract);
export const merge = computed(() => llm.value.merge);
export const assign = computed(() => llm.value.assign);
export const backup = computed(() => llm.value.backup);
export const useVoting = computed(() => llm.value.useVoting);
export const poolRaw = computed(() => llm.value.poolRaw);

/** One parse per textarea change, shared by the validity and entry views. */
const poolParse = computed<{ entries: PoolEntry[]; error: string | null }>(() => {
  try {
    return { entries: parsePoolTextarea(llm.value.poolRaw), error: null };
  } catch (e) {
    return { entries: [], error: e instanceof PoolParseError ? e.message : String(e) };
  }
});

/** Parsed Connection pool; an invalid textarea yields no slots until fixed. */
export const poolEntries = computed<PoolEntry[]>(() => poolParse.value.entries);

/** First `Line N` reason when the textarea draft is invalid; null when it parses. */
export const poolError = computed<string | null>(() => poolParse.value.error);

/** An empty textarea is valid; it just keeps the per-stage behavior. */
export const poolValid = computed(() => poolParse.value.error === null);

/** True when a valid, non-empty Connection pool will serve the Conversion. */
export const poolActive = computed(() => llm.value.poolRaw.trim().length > 0 && poolValid.value);

// ============================================================================
// Computed Properties
// ============================================================================

export const isConfigured = computed(
  () =>
    poolActive.value ||
    llm.value.extract.apiKey.length > 0 ||
    llm.value.merge.apiKey.length > 0 ||
    llm.value.assign.apiKey.length > 0,
);

export const isProcessing = computed(() => {
  const status = llm.value.processingStatus;
  return status === 'extracting' || status === 'assigning';
});

export const characterLineCounts = computed(() => {
  const assignments = llm.value.speakerAssignments;
  const counts = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      counts.set(a.speaker, (counts.get(a.speaker) ?? 0) + 1);
    }
  }
  return counts;
});

// ============================================================================
// Persistence
// ============================================================================

let _savePending = false;
let saveTimer: number | null = null;

async function saveSettings(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  _savePending = true;

  try {
    const [extractKey, mergeKey, assignKey, backupKey, poolBlob] = await Promise.all([
      encryptValue(llm.value.extract.apiKey),
      encryptValue(llm.value.merge.apiKey),
      encryptValue(llm.value.assign.apiKey),
      encryptValue(llm.value.backup.apiKey),
      // The whole textarea is one blob: per-entry `key` fields never reach
      // localStorage as plain text, and the raw string round-trips exactly.
      // An invalid line keeps the last valid blob on disk.
      poolValid.value ? encryptValue(llm.value.poolRaw) : Promise.resolve(null),
    ]);

    const settings: LLMSettings = {
      useVoting: llm.value.useVoting,
      extract: { ...llm.value.extract, apiKey: extractKey },
      merge: { ...llm.value.merge, apiKey: mergeKey },
      assign: { ...llm.value.assign, apiKey: assignKey },
      backup: { ...llm.value.backup, apiKey: backupKey },
    };
    saveJSON(StorageKeys.llmSettings, settings);
    if (poolBlob !== null) localStorage.setItem(StorageKeys.llmPool, poolBlob);
  } finally {
    _savePending = false;
  }
}

function scheduleSave(): void {
  // Debounce from the latest write, so a burst of textarea input saves once
  // with the final text instead of on the first keystroke's deadline.
  clearTimeout(saveTimer ?? undefined);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveSettings();
  }, 100);
}

export async function loadSettings(logStore: LoggerStore): Promise<void> {
  try {
    const saved = localStorage.getItem(StorageKeys.llmSettings);
    if (saved) {
      const settings: LLMSettings = JSON.parse(saved);

      llm.value = {
        ...llm.value,
        useVoting: settings.useVoting ?? defaultPersistedState.useVoting,
      };

      for (const stage of ['extract', 'merge', 'assign', 'backup'] as const) {
        const persisted = settings[stage];
        if (!persisted) continue;

        // Same semantics as a per-field `persisted[key] ?? default` merge: JSON null
        // resets a field to its default, unknown keys are dropped, and apiKey is
        // decrypted separately instead of merged.
        const config: StageConfig = {
          ...defaultStageConfig,
          ...Object.fromEntries(
            (Object.keys(defaultStageConfig) as (keyof StageConfig)[])
              .map((key) => [key, persisted[key]] as const)
              .filter(([, value]) => value != null),
          ),
        };
        config.apiKey = await decryptValue(persisted.apiKey ?? '', logStore);

        llm.value = { ...llm.value, [stage]: config };
      }
    }

    // The pool blob loads even when the stage settings key is absent.
    const poolBlob = localStorage.getItem(StorageKeys.llmPool);
    if (poolBlob) {
      llm.value = { ...llm.value, poolRaw: await decryptValue(poolBlob, logStore) };
    }
  } catch (e) {
    logStore.error(
      'Failed to load LLM settings',
      e instanceof Error ? e : undefined,
      e instanceof Error ? undefined : { error: String(e) },
    );
  }
}

// ============================================================================
// Internal State Updates
// ============================================================================

function patchState(partial: Partial<LLMState>): void {
  llm.value = { ...llm.value, ...partial };
}

// ============================================================================
// Public API - Settings Actions
// ============================================================================

export function setUseVoting(value: boolean): void {
  patchState({ useVoting: value });
  scheduleSave();
}

export function setStageField<K extends keyof StageConfig>(
  stage: LLMStage,
  field: K,
  value: StageConfig[K],
): void {
  const current = llm.value[stage];
  patchState({ [stage]: { ...current, [field]: value } });
  scheduleSave();
}

export function setStageConfig(stage: LLMStage, config: StageConfig): void {
  patchState({ [stage]: { ...config } });
  scheduleSave();
}

/** Replaces the Connection pool textarea exactly as typed; validity is derived, never stored. */
export function setPoolRaw(raw: string): void {
  patchState({ poolRaw: raw });
  scheduleSave();
}

// ============================================================================
// Public API - Processing State Actions
// ============================================================================

export function setProcessingStatus(status: LLMProcessingStatus): void {
  patchState({ processingStatus: status });
}

export function setBlockProgress(current: number, total: number): void {
  patchState({ currentBlock: current, totalBlocks: total });
}

export function setError(error: string | null): void {
  patchState({ error, processingStatus: error ? 'error' : llm.value.processingStatus });
}

// ============================================================================
// Public API - Character Data Actions
// ============================================================================

export function setCharacters(characters: LLMCharacter[]): void {
  patchState({ detectedCharacters: characters });
}

export function setVoiceMap(map: Map<string, string>): void {
  patchState({ characterVoiceMap: new Map(map) });
}

export function setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
  patchState({ speakerAssignments: assignments });
}

export function setLoadedProfile(profile: VoiceProfileFile | null): void {
  patchState({ loadedProfile: profile });
}

// ============================================================================
// Public API - State Management
// ============================================================================

export function resetProcessingState(): void {
  patchState({
    ...defaultTransientState,
    useVoting: llm.value.useVoting,
    extract: llm.value.extract,
    merge: llm.value.merge,
    assign: llm.value.assign,
  });
}

export function resetLLMStore(): void {
  llm.value = {
    ...defaultPersistedState,
    ...defaultTransientState,
  };
}
