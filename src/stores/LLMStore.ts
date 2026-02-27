// LLM Store
// Manages LLM settings and character detection state

import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';
import type { LoggerStore } from '@/services/Logger';
import { decryptValue, encryptValue } from '@/services/SecureStorage';
import type { LLMCharacter, SpeakerAssignment, VoiceProfileFile } from '@/state/types';

// ============================================================================
// Types
// ============================================================================

export type LLMProcessingStatus = 'idle' | 'extracting' | 'review' | 'assigning' | 'error';
export type ReasoningLevel = 'auto' | 'high' | 'medium' | 'low';
export type LLMStage = 'extract' | 'merge' | 'assign';

export interface StageConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming: boolean;
  reasoning: ReasoningLevel | null;
  temperature: number;
  topP: number;
  repeatPrompt: boolean;
}

interface LLMSettings {
  useVoting: boolean;
  extract: StageConfig;
  merge: StageConfig;
  assign: StageConfig;
}

interface LLMState {
  // Settings (persisted)
  useVoting: boolean;
  extract: StageConfig;
  merge: StageConfig;
  assign: StageConfig;

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
  pendingReview: boolean;
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
};

const defaultPersistedState: LLMSettings = {
  useVoting: false,
  extract: { ...defaultStageConfig },
  merge: { ...defaultStageConfig },
  assign: { ...defaultStageConfig },
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
  pendingReview: false,
};

// ============================================================================
// Store Definition
// ============================================================================

export const llm = signal<LLMState>({
  ...defaultPersistedState,
  ...defaultTransientState,
});

// Export direct signal references for the orchestrator
export const characterVoiceMap = computed(() => llm.value.characterVoiceMap);
export const loadedProfile = computed(() => llm.value.loadedProfile);

// Export computed for nested state access
export const pendingReview = computed(() => llm.value.pendingReview);
export const detectedCharacters = computed(() => llm.value.detectedCharacters);
export const speakerAssignments = computed(() => llm.value.speakerAssignments);
export const processingStatus = computed(() => llm.value.processingStatus);
export const error = computed(() => llm.value.error);

// Export computed for stage config access
export const extract = computed(() => llm.value.extract);
export const merge = computed(() => llm.value.merge);
export const assign = computed(() => llm.value.assign);
export const useVoting = computed(() => llm.value.useVoting);

// Review promise resolvers (not persisted)
let reviewResolver: (() => void) | null = null;
let reviewRejecter: ((reason: Error) => void) | null = null;

// ============================================================================
// Computed Properties
// ============================================================================

export const isConfigured = computed(
  () =>
    llm.value.extract.apiKey.length > 0 ||
    llm.value.merge.apiKey.length > 0 ||
    llm.value.assign.apiKey.length > 0,
);

export const isProcessing = computed(() => {
  const status = llm.value.processingStatus;
  return status === 'extracting' || status === 'assigning';
});

export const blockProgress = computed(() => ({
  current: llm.value.currentBlock,
  total: llm.value.totalBlocks,
}));

export const characterNames = computed(() =>
  llm.value.detectedCharacters.map((c) => c.canonicalName),
);

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
    const [extractKey, mergeKey, assignKey] = await Promise.all([
      encryptValue(llm.value.extract.apiKey),
      encryptValue(llm.value.merge.apiKey),
      encryptValue(llm.value.assign.apiKey),
    ]);

    const settings: LLMSettings = {
      useVoting: llm.value.useVoting,
      extract: { ...llm.value.extract, apiKey: extractKey },
      merge: { ...llm.value.merge, apiKey: mergeKey },
      assign: { ...llm.value.assign, apiKey: assignKey },
    };
    localStorage.setItem(StorageKeys.llmSettings, JSON.stringify(settings));
  } finally {
    _savePending = false;
  }
}

function scheduleSave(): void {
  if (!saveTimer) {
    saveTimer = window.setTimeout(() => {
      saveSettings();
      saveTimer = null;
    }, 100);
  }
}

export async function loadSettings(logStore: LoggerStore): Promise<void> {
  try {
    const saved = localStorage.getItem(StorageKeys.llmSettings);
    if (!saved) return;

    const settings: LLMSettings = JSON.parse(saved);

    llm.value = {
      ...llm.value,
      useVoting: settings.useVoting ?? defaultPersistedState.useVoting,
    };

    for (const stage of ['extract', 'merge', 'assign'] as const) {
      if (settings[stage]) {
        const decryptedKey = await decryptValue(settings[stage].apiKey ?? '', logStore);
        llm.value = {
          ...llm.value,
          [stage]: {
            apiKey: decryptedKey,
            apiUrl: settings[stage].apiUrl ?? defaultStageConfig.apiUrl,
            model: settings[stage].model ?? defaultStageConfig.model,
            streaming: settings[stage].streaming ?? defaultStageConfig.streaming,
            reasoning: settings[stage].reasoning ?? defaultStageConfig.reasoning,
            temperature: settings[stage].temperature ?? defaultStageConfig.temperature,
            topP: settings[stage].topP ?? defaultStageConfig.topP,
            repeatPrompt: settings[stage].repeatPrompt ?? defaultStageConfig.repeatPrompt,
          },
        };
      }
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

export function getStageConfig(stage: LLMStage): StageConfig {
  return llm.value[stage];
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

export function addCharacter(character: LLMCharacter): void {
  patchState({ detectedCharacters: [...llm.value.detectedCharacters, character] });
}

export function updateCharacter(index: number, updates: Partial<LLMCharacter>): void {
  const characters = [...llm.value.detectedCharacters];
  if (index >= 0 && index < characters.length) {
    characters[index] = { ...characters[index], ...updates };
    patchState({ detectedCharacters: characters });
  }
}

export function removeCharacter(index: number): void {
  const characters = [...llm.value.detectedCharacters];
  characters.splice(index, 1);
  patchState({ detectedCharacters: characters });
}

export function setVoiceMap(map: Map<string, string>): void {
  patchState({ characterVoiceMap: new Map(map) });
}

export function updateVoiceMapping(characterName: string, voiceId: string): void {
  const map = new Map(llm.value.characterVoiceMap);
  map.set(characterName, voiceId);
  patchState({ characterVoiceMap: map });
}

export function removeVoiceMapping(characterName: string): void {
  const map = new Map(llm.value.characterVoiceMap);
  map.delete(characterName);
  patchState({ characterVoiceMap: map });
}

export function setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
  patchState({ speakerAssignments: assignments });
}

export function setLoadedProfile(profile: VoiceProfileFile | null): void {
  patchState({ loadedProfile: profile });
}

// ============================================================================
// Public API - Voice Review Actions
// ============================================================================

export function setPendingReview(value: boolean): void {
  patchState({
    pendingReview: value,
    processingStatus: value ? 'review' : llm.value.processingStatus,
  });
}

export function awaitReview(): Promise<void> {
  return new Promise((resolve, reject) => {
    reviewResolver = resolve;
    reviewRejecter = reject;
  });
}

export function confirmReview(): void {
  patchState({ pendingReview: false });
  reviewResolver?.();
  reviewResolver = null;
  reviewRejecter = null;
}

export function cancelReview(): void {
  patchState({ pendingReview: false });
  reviewRejecter?.(new Error('Voice review cancelled'));
  reviewResolver = null;
  reviewRejecter = null;
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

export function reset(): void {
  resetLLMStore();
}
