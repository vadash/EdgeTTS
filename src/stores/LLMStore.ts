// LLM Store
// Manages LLM settings and character detection state

import { signal, computed, effect } from '@preact/signals';
import type { LLMCharacter, SpeakerAssignment, VoiceProfileFile } from '@/state/types';
import { encryptValue, decryptValue } from '@/services/SecureStorage';
import type { LogStore } from './LogStore';
import { StorageKeys } from '@/config/storage';

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

// Root signal with default state
const rootSignal = signal<LLMState>({
  ...defaultPersistedState,
  ...defaultTransientState,
});

// Review promise resolvers (not persisted)
let reviewResolver: (() => void) | null = null;
let reviewRejecter: ((reason: Error) => void) | null = null;

// ============================================================================
// Computed Properties
// ============================================================================

const isConfiguredComputed = computed(() =>
  rootSignal.value.extract.apiKey.length > 0 ||
  rootSignal.value.merge.apiKey.length > 0 ||
  rootSignal.value.assign.apiKey.length > 0
);

const isProcessingComputed = computed(() => {
  const status = rootSignal.value.processingStatus;
  return status === 'extracting' || status === 'assigning';
});

const blockProgressComputed = computed(() => ({
  current: rootSignal.value.currentBlock,
  total: rootSignal.value.totalBlocks,
}));

const characterNamesComputed = computed(() =>
  rootSignal.value.detectedCharacters.map(c => c.canonicalName)
);

const characterLineCountsComputed = computed(() => {
  const assignments = rootSignal.value.speakerAssignments;
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

let savePending = false;
let saveTimer: number | null = null;

/**
 * Async save with encryption - debounced to batch rapid changes
 */
async function saveSettings(): Promise<void> {
  // Clear any pending save timer
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  savePending = true;

  try {
    // Encrypt all API keys in parallel
    const [extractKey, mergeKey, assignKey] = await Promise.all([
      encryptValue(rootSignal.value.extract.apiKey),
      encryptValue(rootSignal.value.merge.apiKey),
      encryptValue(rootSignal.value.assign.apiKey),
    ]);

    const settings: LLMSettings = {
      useVoting: rootSignal.value.useVoting,
      extract: { ...rootSignal.value.extract, apiKey: extractKey },
      merge: { ...rootSignal.value.merge, apiKey: mergeKey },
      assign: { ...rootSignal.value.assign, apiKey: assignKey },
    };
    localStorage.setItem(StorageKeys.llmSettings, JSON.stringify(settings));
  } finally {
    savePending = false;
  }
}

/**
 * Debounced save - schedules a save if none pending
 */
function scheduleSave(): void {
  if (!saveTimer) {
    saveTimer = window.setTimeout(() => {
      saveSettings();
      saveTimer = null;
    }, 100);
  }
}

/**
 * Load settings from localStorage with decryption
 */
async function loadSettings(logStore: LogStore): Promise<void> {
  try {
    const saved = localStorage.getItem(StorageKeys.llmSettings);
    if (!saved) return;

    const settings: LLMSettings = JSON.parse(saved);

    rootSignal.value = {
      ...rootSignal.value,
      useVoting: settings.useVoting ?? defaultPersistedState.useVoting,
    };

    for (const stage of ['extract', 'merge', 'assign'] as const) {
      if (settings[stage]) {
        const decryptedKey = await decryptValue(settings[stage].apiKey ?? '', logStore);
        rootSignal.value = {
          ...rootSignal.value,
          [stage]: {
            apiKey: decryptedKey,
            apiUrl: settings[stage].apiUrl ?? defaultStageConfig.apiUrl,
            model: settings[stage].model ?? defaultStageConfig.model,
            streaming: settings[stage].streaming ?? defaultStageConfig.streaming,
            reasoning: settings[stage].reasoning ?? defaultStageConfig.reasoning,
            temperature: settings[stage].temperature ?? defaultStageConfig.temperature,
            topP: settings[stage].topP ?? defaultStageConfig.topP,
          },
        };
      }
    }
  } catch (e) {
    logStore.error(
      'Failed to load LLM settings',
      e instanceof Error ? e : undefined,
      e instanceof Error ? undefined : { error: String(e) }
    );
  }
}

// ============================================================================
// Internal State Updates
// ============================================================================>

function patchState(partial: Partial<LLMState>): void {
  rootSignal.value = { ...rootSignal.value, ...partial };
}

// ============================================================================
// Public API - Settings Actions
// ============================================================================

function setUseVoting(value: boolean): void {
  patchState({ useVoting: value });
  scheduleSave();
}

function setStageField<K extends keyof StageConfig>(
  stage: LLMStage,
  field: K,
  value: StageConfig[K]
): void {
  const current = rootSignal.value[stage];
  patchState({ [stage]: { ...current, [field]: value } });
  scheduleSave();
}

function setStageConfig(stage: LLMStage, config: StageConfig): void {
  patchState({ [stage]: { ...config } });
  scheduleSave();
}

function getStageConfig(stage: LLMStage): StageConfig {
  return rootSignal.value[stage];
}

// ============================================================================
// Public API - Processing State Actions
// ============================================================================

function setProcessingStatus(status: LLMProcessingStatus): void {
  patchState({ processingStatus: status });
}

function setBlockProgress(current: number, total: number): void {
  patchState({ currentBlock: current, totalBlocks: total });
}

function setError(error: string | null): void {
  patchState({ error, processingStatus: error ? 'error' : rootSignal.value.processingStatus });
}

// ============================================================================
// Public API - Character Data Actions
// ============================================================================

function setCharacters(characters: LLMCharacter[]): void {
  patchState({ detectedCharacters: characters });
}

function addCharacter(character: LLMCharacter): void {
  patchState({ detectedCharacters: [...rootSignal.value.detectedCharacters, character] });
}

function updateCharacter(index: number, updates: Partial<LLMCharacter>): void {
  const characters = [...rootSignal.value.detectedCharacters];
  if (index >= 0 && index < characters.length) {
    characters[index] = { ...characters[index], ...updates };
    patchState({ detectedCharacters: characters });
  }
}

function removeCharacter(index: number): void {
  const characters = [...rootSignal.value.detectedCharacters];
  characters.splice(index, 1);
  patchState({ detectedCharacters: characters });
}

function setVoiceMap(map: Map<string, string>): void {
  patchState({ characterVoiceMap: new Map(map) });
}

function updateVoiceMapping(characterName: string, voiceId: string): void {
  const map = new Map(rootSignal.value.characterVoiceMap);
  map.set(characterName, voiceId);
  patchState({ characterVoiceMap: map });
}

function removeVoiceMapping(characterName: string): void {
  const map = new Map(rootSignal.value.characterVoiceMap);
  map.delete(characterName);
  patchState({ characterVoiceMap: map });
}

function setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
  patchState({ speakerAssignments: assignments });
}

function setLoadedProfile(profile: VoiceProfileFile | null): void {
  patchState({ loadedProfile: profile });
}

// ============================================================================
// Public API - Voice Review Actions
// ============================================================================

function setPendingReview(value: boolean): void {
  patchState({
    pendingReview: value,
    processingStatus: value ? 'review' : rootSignal.value.processingStatus,
  });
}

function awaitReview(): Promise<void> {
  return new Promise((resolve, reject) => {
    reviewResolver = resolve;
    reviewRejecter = reject;
  });
}

function confirmReview(): void {
  patchState({ pendingReview: false });
  reviewResolver?.();
  reviewResolver = null;
  reviewRejecter = null;
}

function cancelReview(): void {
  patchState({ pendingReview: false });
  reviewRejecter?.(new Error('Voice review cancelled'));
  reviewResolver = null;
  reviewRejecter = null;
}

// ============================================================================
// Public API - State Management
// ============================================================================

function resetProcessingState(): void {
  patchState({
    ...defaultTransientState,
    // Preserve settings
    useVoting: rootSignal.value.useVoting,
    extract: rootSignal.value.extract,
    merge: rootSignal.value.merge,
    assign: rootSignal.value.assign,
  });
}

function reset(): void {
  patchState({
    ...defaultPersistedState,
    ...defaultTransientState,
  });
}

// ============================================================================
// Legacy Class Wrapper
// ============================================================================

class PropertySignal<T> {
  constructor(private fn: (s: LLMState) => T) {}

  get value(): T {
    return this.fn(rootSignal.value);
  }
  set value(_v: T) {}
}

class StagePropertySignal {
  constructor(private stage: LLMStage) {}

  get value(): StageConfig {
    return rootSignal.value[this.stage];
  }
  set value(v: StageConfig) {
    setStageConfig(this.stage, v);
  }
}

export class LLMStore {
  private readonly logStore: LogStore;

  // Settings properties
  readonly useVoting = new PropertySignal(s => s.useVoting);
  readonly extract = new StagePropertySignal('extract');
  readonly merge = new StagePropertySignal('merge');
  readonly assign = new StagePropertySignal('assign');

  // Processing state properties
  readonly processingStatus = new PropertySignal(s => s.processingStatus);
  readonly currentBlock = new PropertySignal(s => s.currentBlock);
  readonly totalBlocks = new PropertySignal(s => s.totalBlocks);
  readonly error = new PropertySignal(s => s.error);

  // Character data properties
  readonly detectedCharacters = new PropertySignal(s => s.detectedCharacters);
  readonly characterVoiceMap = new PropertySignal(s => s.characterVoiceMap);
  readonly speakerAssignments = new PropertySignal(s => s.speakerAssignments);
  readonly loadedProfile = new PropertySignal(s => s.loadedProfile);

  // Voice review state
  readonly pendingReview = new PropertySignal(s => s.pendingReview);

  // Computed
  readonly isConfigured = isConfiguredComputed;
  readonly isProcessing = isProcessingComputed;
  readonly blockProgress = blockProgressComputed;
  readonly characterNames = characterNamesComputed;
  readonly characterLineCounts = characterLineCountsComputed;

  constructor(logStore: LogStore) {
    this.logStore = logStore;
  }

  // Settings Actions
  setUseVoting = setUseVoting;
  setStageField = setStageField;
  setStageConfig = setStageConfig;
  getStageConfig = getStageConfig;

  // Processing State Actions
  setProcessingStatus = setProcessingStatus;
  setBlockProgress = setBlockProgress;
  setError = setError;

  // Character Data Actions
  setCharacters = setCharacters;
  addCharacter = addCharacter;
  updateCharacter = updateCharacter;
  removeCharacter = removeCharacter;
  setVoiceMap = setVoiceMap;
  updateVoiceMapping = updateVoiceMapping;
  removeVoiceMapping = removeVoiceMapping;
  setSpeakerAssignments = setSpeakerAssignments;
  setLoadedProfile = setLoadedProfile;

  // Voice Review Actions
  setPendingReview = setPendingReview;
  awaitReview = awaitReview;
  confirmReview = confirmReview;
  cancelReview = cancelReview;

  // State Management
  resetProcessingState = resetProcessingState;
  reset = reset;

  // Persistence
  async saveSettings(): Promise<void> {
    await saveSettings();
  }

  async loadSettings(): Promise<void> {
    await loadSettings(this.logStore);
  }
}

/**
 * Reset to defaults (for tests)
 */
export function resetLLMStore(): void {
  rootSignal.value = {
    ...defaultPersistedState,
    ...defaultTransientState,
  };
}

export function createLLMStore(logStore: LogStore): LLMStore {
  return new LLMStore(logStore);
}

// Export for direct access
export const llm = rootSignal;
export const isConfigured = isConfiguredComputed;
export const isProcessing = isProcessingComputed;
