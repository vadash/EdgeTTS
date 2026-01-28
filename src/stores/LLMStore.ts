// LLM Store
// Manages LLM settings and character detection state

import { signal, computed } from '@preact/signals';
import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
import { encryptValue, decryptValue } from '@/services/SecureStorage';
import type { LogStore } from './LogStore';
import { StorageKeys } from '@/config/storage';

/**
 * LLM processing status
 */
export type LLMProcessingStatus = 'idle' | 'extracting' | 'review' | 'assigning' | 'error';

/**
 * Reasoning effort level for reasoning models
 */
export type ReasoningLevel = 'auto' | 'high' | 'medium' | 'low';

/**
 * LLM pipeline stage
 */
export type LLMStage = 'extract' | 'merge' | 'assign';

/**
 * Per-stage LLM configuration
 */
export interface StageConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming: boolean;
  reasoning: ReasoningLevel | null;
  temperature: number;
  topP: number;
}

/**
 * Default stage configuration
 */
const defaultStageConfig: StageConfig = {
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  streaming: true,
  reasoning: null,
  temperature: 0.0,
  topP: 0.95,
};

/**
 * LLM settings for persistence (new format with per-stage configs)
 */
interface LLMSettings {
  enabled: boolean;
  useVoting: boolean;
  extract: StageConfig;
  merge: StageConfig;
  assign: StageConfig;
}

/**
 * Default LLM settings
 */
const defaultLLMSettings: LLMSettings = {
  enabled: true,
  useVoting: false,
  extract: { ...defaultStageConfig },
  merge: { ...defaultStageConfig },
  assign: { ...defaultStageConfig },
};

/**
 * LLM Store - manages LLM settings and character data
 */
export class LLMStore {
  private readonly logStore: LogStore;

  // Global settings (persisted)
  readonly enabled = signal<boolean>(defaultLLMSettings.enabled);
  readonly useVoting = signal<boolean>(defaultLLMSettings.useVoting);

  // Per-stage configurations (persisted)
  readonly extract = signal<StageConfig>({ ...defaultStageConfig });
  readonly merge = signal<StageConfig>({ ...defaultStageConfig });
  readonly assign = signal<StageConfig>({ ...defaultStageConfig });

  // Processing state
  readonly processingStatus = signal<LLMProcessingStatus>('idle');
  readonly currentBlock = signal<number>(0);
  readonly totalBlocks = signal<number>(0);
  readonly error = signal<string | null>(null);

  // Character data
  readonly detectedCharacters = signal<LLMCharacter[]>([]);
  readonly characterVoiceMap = signal<Map<string, string>>(new Map());
  readonly speakerAssignments = signal<SpeakerAssignment[]>([]);

  // Voice review state
  readonly pendingReview = signal<boolean>(false);
  private reviewResolver: (() => void) | null = null;
  private reviewRejecter: ((reason: Error) => void) | null = null;

  constructor(logStore: LogStore) {
    this.logStore = logStore;
  }

  // ========== Computed Properties ==========

  /**
   * Check if LLM is configured (any stage has API key)
   */
  readonly isConfigured = computed(() =>
    this.extract.value.apiKey.length > 0 ||
    this.merge.value.apiKey.length > 0 ||
    this.assign.value.apiKey.length > 0
  );

  /**
   * Check if currently processing
   */
  readonly isProcessing = computed(() => {
    const status = this.processingStatus.value;
    return status === 'extracting' || status === 'assigning';
  });

  /**
   * Get block progress
   */
  readonly blockProgress = computed(() => ({
    current: this.currentBlock.value,
    total: this.totalBlocks.value,
  }));

  /**
   * Get character names
   */
  readonly characterNames = computed(() =>
    this.detectedCharacters.value.map(c => c.canonicalName)
  );

  /**
   * Get line counts per character
   */
  readonly characterLineCounts = computed(() => {
    const assignments = this.speakerAssignments.value;
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (a.speaker !== 'narrator') {
        counts.set(a.speaker, (counts.get(a.speaker) ?? 0) + 1);
      }
    }
    return counts;
  });

  // ========== Settings Actions ==========

  setEnabled(value: boolean): void {
    this.enabled.value = value;
    this.saveSettings();
  }

  toggleEnabled(): void {
    this.enabled.value = !this.enabled.value;
    this.saveSettings();
  }

  setUseVoting(value: boolean): void {
    this.useVoting.value = value;
    this.saveSettings();
  }

  /**
   * Set a field for a specific stage
   */
  setStageField<K extends keyof StageConfig>(
    stage: LLMStage,
    field: K,
    value: StageConfig[K]
  ): void {
    const current = this[stage].value;
    this[stage].value = { ...current, [field]: value };
    this.saveSettings();
  }

  /**
   * Set entire stage config
   */
  setStageConfig(stage: LLMStage, config: StageConfig): void {
    this[stage].value = { ...config };
    this.saveSettings();
  }

  /**
   * Get stage config
   */
  getStageConfig(stage: LLMStage): StageConfig {
    return this[stage].value;
  }

  // ========== Processing State Actions ==========

  setProcessingStatus(status: LLMProcessingStatus): void {
    this.processingStatus.value = status;
  }

  setBlockProgress(current: number, total: number): void {
    this.currentBlock.value = current;
    this.totalBlocks.value = total;
  }

  setError(error: string | null): void {
    this.error.value = error;
    if (error) {
      this.processingStatus.value = 'error';
    }
  }

  // ========== Character Data Actions ==========

  setCharacters(characters: LLMCharacter[]): void {
    this.detectedCharacters.value = characters;
  }

  addCharacter(character: LLMCharacter): void {
    this.detectedCharacters.value = [...this.detectedCharacters.value, character];
  }

  updateCharacter(index: number, updates: Partial<LLMCharacter>): void {
    const characters = [...this.detectedCharacters.value];
    if (index >= 0 && index < characters.length) {
      characters[index] = { ...characters[index], ...updates };
      this.detectedCharacters.value = characters;
    }
  }

  removeCharacter(index: number): void {
    const characters = [...this.detectedCharacters.value];
    characters.splice(index, 1);
    this.detectedCharacters.value = characters;
  }

  setVoiceMap(map: Map<string, string>): void {
    this.characterVoiceMap.value = new Map(map);
  }

  updateVoiceMapping(characterName: string, voiceId: string): void {
    const map = new Map(this.characterVoiceMap.value);
    map.set(characterName, voiceId);
    this.characterVoiceMap.value = map;
  }

  removeVoiceMapping(characterName: string): void {
    const map = new Map(this.characterVoiceMap.value);
    map.delete(characterName);
    this.characterVoiceMap.value = map;
  }

  setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
    this.speakerAssignments.value = assignments;
  }

  // ========== Voice Review Actions ==========

  /**
   * Set pending review state
   */
  setPendingReview(value: boolean): void {
    this.pendingReview.value = value;
    if (value) {
      this.processingStatus.value = 'review';
    }
  }

  /**
   * Wait for user to complete voice review
   * Returns a promise that resolves when user clicks Continue
   * or rejects when user clicks Cancel
   */
  awaitReview(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.reviewResolver = resolve;
      this.reviewRejecter = reject;
    });
  }

  /**
   * Called when user confirms voice review (Continue button)
   */
  confirmReview(): void {
    this.pendingReview.value = false;
    this.reviewResolver?.();
    this.reviewResolver = null;
    this.reviewRejecter = null;
  }

  /**
   * Called when user cancels voice review (Cancel button)
   */
  cancelReview(): void {
    this.pendingReview.value = false;
    this.reviewRejecter?.(new Error('Voice review cancelled'));
    this.reviewResolver = null;
    this.reviewRejecter = null;
  }

  // ========== State Management ==========

  /**
   * Reset processing state (but keep settings)
   */
  resetProcessingState(): void {
    this.processingStatus.value = 'idle';
    this.currentBlock.value = 0;
    this.totalBlocks.value = 0;
    this.error.value = null;
    this.detectedCharacters.value = [];
    this.characterVoiceMap.value = new Map();
    this.speakerAssignments.value = [];
    this.pendingReview.value = false;
    this.reviewResolver = null;
    this.reviewRejecter = null;
  }

  /**
   * Full reset including settings
   */
  reset(): void {
    this.resetProcessingState();
    this.enabled.value = defaultLLMSettings.enabled;
    this.useVoting.value = defaultLLMSettings.useVoting;
    this.extract.value = { ...defaultStageConfig };
    this.merge.value = { ...defaultStageConfig };
    this.assign.value = { ...defaultStageConfig };
  }

  // ========== Persistence ==========

  /**
   * Save settings to localStorage (async for encryption)
   */
  async saveSettings(): Promise<void> {
    try {
      // Encrypt all API keys in parallel
      const [extractKey, mergeKey, assignKey] = await Promise.all([
        encryptValue(this.extract.value.apiKey),
        encryptValue(this.merge.value.apiKey),
        encryptValue(this.assign.value.apiKey),
      ]);

      const settings: LLMSettings = {
        enabled: this.enabled.value,
        useVoting: this.useVoting.value,
        extract: { ...this.extract.value, apiKey: extractKey },
        merge: { ...this.merge.value, apiKey: mergeKey },
        assign: { ...this.assign.value, apiKey: assignKey },
      };
      localStorage.setItem(StorageKeys.llmSettings, JSON.stringify(settings));
    } catch (e) {
      this.logStore.error(
        'Failed to save LLM settings',
        e instanceof Error ? e : undefined,
        e instanceof Error ? undefined : { error: String(e) }
      );
    }
  }

  /**
   * Load settings from localStorage (async for decryption)
   */
  async loadSettings(): Promise<void> {
    try {
      const saved = localStorage.getItem(StorageKeys.llmSettings);
      if (!saved) return;

      const settings = JSON.parse(saved);

      this.enabled.value = settings.enabled ?? defaultLLMSettings.enabled;
      this.useVoting.value = settings.useVoting ?? defaultLLMSettings.useVoting;

      for (const stage of ['extract', 'merge', 'assign'] as const) {
        if (settings[stage]) {
          const decryptedKey = await decryptValue(settings[stage].apiKey ?? '', this.logStore);
          this[stage].value = {
            apiKey: decryptedKey,
            apiUrl: settings[stage].apiUrl ?? defaultStageConfig.apiUrl,
            model: settings[stage].model ?? defaultStageConfig.model,
            streaming: settings[stage].streaming ?? defaultStageConfig.streaming,
            reasoning: settings[stage].reasoning ?? defaultStageConfig.reasoning,
            temperature: settings[stage].temperature ?? defaultStageConfig.temperature,
            topP: settings[stage].topP ?? defaultStageConfig.topP,
          };
        }
      }
    } catch (e) {
      this.logStore.error(
        'Failed to load LLM settings',
        e instanceof Error ? e : undefined,
        e instanceof Error ? undefined : { error: String(e) }
      );
    }
  }
}

/**
 * Create a new LLMStore instance
 */
export function createLLMStore(logStore: LogStore): LLMStore {
  return new LLMStore(logStore);
}
