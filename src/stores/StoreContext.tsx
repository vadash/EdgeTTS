// Store Context for Preact
// Provides React-like context for state management

import { createContext, ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

import type { LoggerStore } from '@/services/Logger';
import { DataStore } from './DataStore';
import { LanguageStore } from './LanguageStore';

// Import signal-based stores
import * as SettingsStore from './SettingsStore';
import * as ConversionStore from './ConversionStore';
import * as LLMStore from './LLMStore';
import { createLoggerStore } from './LoggerStore';
import { createDataStore } from './DataStore';
import { createLanguageStore } from './LanguageStore';

// Import individual exports for typed hook return values
import { settings as settingsSignal, resetSettingsStore } from './SettingsStore';
import { conversion as conversionSignal } from './ConversionStore';
import { llm as llmSignal, loadSettings as llmLoadSettings } from './LLMStore';

// ============================================================================
// Store Types
// ============================================================================

/**
 * Settings store interface (all exports from SettingsStore module)
 */
export interface SettingsStoreType {
  // Signals and computed values
  settings: ReturnType<typeof settingsSignal>;
  voice: typeof import('./SettingsStore').voice;
  narratorVoice: typeof import('./SettingsStore').narratorVoice;
  voicePoolLocale: typeof import('./SettingsStore').voicePoolLocale;
  enabledVoices: typeof import('./SettingsStore').enabledVoices;
  rate: typeof import('./SettingsStore').rate;
  pitch: typeof import('./SettingsStore').pitch;
  ttsThreads: typeof import('./SettingsStore').ttsThreads;
  llmThreads: typeof import('./SettingsStore').llmThreads;
  lexxRegister: typeof import('./SettingsStore').lexxRegister;
  showDopSettings: typeof import('./SettingsStore').showDopSettings;
  isLiteMode: typeof import('./SettingsStore').isLiteMode;
  statusAreaWidth: typeof import('./SettingsStore').statusAreaWidth;
  outputFormat: typeof import('./SettingsStore').outputFormat;
  silenceRemovalEnabled: typeof import('./SettingsStore').silenceRemovalEnabled;
  normalizationEnabled: typeof import('./SettingsStore').normalizationEnabled;
  deEssEnabled: typeof import('./SettingsStore').deEssEnabled;
  silenceGapMs: typeof import('./SettingsStore').silenceGapMs;
  eqEnabled: typeof import('./SettingsStore').eqEnabled;
  compressorEnabled: typeof import('./SettingsStore').compressorEnabled;
  fadeInEnabled: typeof import('./SettingsStore').fadeInEnabled;
  stereoWidthEnabled: typeof import('./SettingsStore').stereoWidthEnabled;
  opusPreset: typeof import('./SettingsStore').opusPreset;
  opusMinBitrate: typeof import('./SettingsStore').opusMinBitrate;
  opusMaxBitrate: typeof import('./SettingsStore').opusMaxBitrate;
  opusCompressionLevel: typeof import('./SettingsStore').opusCompressionLevel;
  // Actions
  patchSettings: typeof import('./SettingsStore').patchSettings;
  setVoice: typeof import('./SettingsStore').setVoice;
  setNarratorVoice: typeof import('./SettingsStore').setNarratorVoice;
  setVoicePoolLocale: typeof import('./SettingsStore').setVoicePoolLocale;
  setEnabledVoices: typeof import('./SettingsStore').setEnabledVoices;
  setRate: typeof import('./SettingsStore').setRate;
  setPitch: typeof import('./SettingsStore').setPitch;
  setTtsThreads: typeof import('./SettingsStore').setTtsThreads;
  setLlmThreads: typeof import('./SettingsStore').setLlmThreads;
  setLexxRegister: typeof import('./SettingsStore').setLexxRegister;
  setShowDopSettings: typeof import('./SettingsStore').setShowDopSettings;
  setIsLiteMode: typeof import('./SettingsStore').setIsLiteMode;
  setStatusAreaWidth: typeof import('./SettingsStore').setStatusAreaWidth;
  setOutputFormat: typeof import('./SettingsStore').setOutputFormat;
  setSilenceRemovalEnabled: typeof import('./SettingsStore').setSilenceRemovalEnabled;
  setNormalizationEnabled: typeof import('./SettingsStore').setNormalizationEnabled;
  setDeEssEnabled: typeof import('./SettingsStore').setDeEssEnabled;
  setSilenceGapMs: typeof import('./SettingsStore').setSilenceGapMs;
  setEqEnabled: typeof import('./SettingsStore').setEqEnabled;
  setCompressorEnabled: typeof import('./SettingsStore').setCompressorEnabled;
  setFadeInEnabled: typeof import('./SettingsStore').setFadeInEnabled;
  setStereoWidthEnabled: typeof import('./SettingsStore').setStereoWidthEnabled;
  applyOpusPreset: typeof import('./SettingsStore').applyOpusPreset;
  setOpusMinBitrate: typeof import('./SettingsStore').setOpusMinBitrate;
  setOpusMaxBitrate: typeof import('./SettingsStore').setOpusMaxBitrate;
  setOpusCompressionLevel: typeof import('./SettingsStore').setOpusCompressionLevel;
  // Legacy methods
  save: () => void;
  toObject: () => import('@/state/types').AppSettings;
  reset: () => void;
}

/**
 * Conversion store interface (all exports from ConversionStore module)
 */
export interface ConversionStoreType {
  // Root signal
  value: ReturnType<typeof conversionSignal>;
  // Computed values
  isProcessing: typeof import('./ConversionStore').isProcessing;
  progress: typeof import('./ConversionStore').progress;
  progressPercent: typeof import('./ConversionStore').progressPercent;
  elapsedTime: typeof import('./ConversionStore').elapsedTime;
  estimatedTimeRemaining: typeof import('./ConversionStore').estimatedTimeRemaining;
  status: typeof import('./ConversionStore').status;
  startTime: typeof import('./ConversionStore').startTime;
  error: typeof import('./ConversionStore').error;
  resumeInfo: typeof import('./ConversionStore').resumeInfo;
  ffmpegLoaded: typeof import('./ConversionStore').ffmpegLoaded;
  ffmpegLoading: typeof import('./ConversionStore').ffmpegLoading;
  ffmpegError: typeof import('./ConversionStore').ffmpegError;
  // Actions
  startConversion: typeof import('./ConversionStore').startConversion;
  setStatus: typeof import('./ConversionStore').setStatus;
  updateProgress: typeof import('./ConversionStore').updateProgress;
  incrementProgress: typeof import('./ConversionStore').incrementProgress;
  setTotal: typeof import('./ConversionStore').setTotal;
  setError: typeof import('./ConversionStore').setError;
  complete: typeof import('./ConversionStore').complete;
  cancel: typeof import('./ConversionStore').cancel;
  resetConversionStore: typeof import('./ConversionStore').resetConversionStore;
  setFFmpegLoaded: typeof import('./ConversionStore').setFFmpegLoaded;
  setFFmpegLoading: typeof import('./ConversionStore').setFFmpegLoading;
  setFFmpegError: typeof import('./ConversionStore').setFFmpegError;
  awaitResumeConfirmation: typeof import('./ConversionStore').awaitResumeConfirmation;
  confirmResume: typeof import('./ConversionStore').confirmResume;
  cancelResume: typeof import('./ConversionStore').cancelResume;
}

/**
 * LLM store interface (all exports from LLMStore module)
 */
export interface LLMStoreType {
  // Root signal
  value: ReturnType<typeof llmSignal>;
  // Computed values
  isConfigured: typeof import('./LLMStore').isConfigured;
  characterVoiceMap: typeof import('./LLMStore').characterVoiceMap;
  loadedProfile: typeof import('./LLMStore').loadedProfile;
  pendingReview: typeof import('./LLMStore').pendingReview;
  detectedCharacters: typeof import('./LLMStore').detectedCharacters;
  speakerAssignments: typeof import('./LLMStore').speakerAssignments;
  processingStatus: typeof import('./LLMStore').processingStatus;
  error: typeof import('./LLMStore').error;
  extract: typeof import('./LLMStore').extract;
  merge: typeof import('./LLMStore').merge;
  assign: typeof import('./LLMStore').assign;
  useVoting: typeof import('./LLMStore').useVoting;
  characterNames: typeof import('./LLMStore').characterNames;
  characterLineCounts: typeof import('./LLMStore').characterLineCounts;
  blockProgress: typeof import('./LLMStore').blockProgress;
  // Actions
  setUseVoting: typeof import('./LLMStore').setUseVoting;
  setStageField: typeof import('./LLMStore').setStageField;
  setStageConfig: typeof import('./LLMStore').setStageConfig;
  getStageConfig: typeof import('./LLMStore').getStageConfig;
  setProcessingStatus: typeof import('./LLMStore').setProcessingStatus;
  setCharacters: typeof import('./LLMStore').setCharacters;
  addCharacter: typeof import('./LLMStore').addCharacter;
  updateCharacter: typeof import('./LLMStore').updateCharacter;
  removeCharacter: typeof import('./LLMStore').removeCharacter;
  setVoiceMap: typeof import('./LLMStore').setVoiceMap;
  updateVoiceMapping: typeof import('./LLMStore').updateVoiceMapping;
  removeVoiceMapping: typeof import('./LLMStore').removeVoiceMapping;
  setSpeakerAssignments: typeof import('./LLMStore').setSpeakerAssignments;
  setLoadedProfile: typeof import('./LLMStore').setLoadedProfile;
  setPendingReview: typeof import('./LLMStore').setPendingReview;
  awaitReview: typeof import('./LLMStore').awaitReview;
  confirmReview: typeof import('./LLMStore').confirmReview;
  cancelReview: typeof import('./LLMStore').cancelReview;
  resetProcessingState: typeof import('./LLMStore').resetProcessingState;
  // Legacy method
  saveSettings: () => Promise<void>;
}

/**
 * All stores combined
 * Settings, Conversion, and LLM are signal-based (no class instances)
 * Logs, Data, and Language remain as class instances for now
 */
export interface Stores {
  // Signal-based stores (export modules)
  settings: typeof SettingsStore;
  conversion: typeof ConversionStore;
  llm: typeof LLMStore;

  // Class-based stores
  logs: LoggerStore;
  data: DataStore;
  language: LanguageStore;
}

// ============================================================================
// Context Definition
// ============================================================================

const StoreContext = createContext<Stores | null>(null);

interface StoreProviderProps {
  stores: Stores;
  children: ComponentChildren;
}

/**
 * Provider component that makes stores available to all children
 */
export function StoreProvider({ stores, children }: StoreProviderProps) {
  return (
    <StoreContext.Provider value={stores}>
      {children}
    </StoreContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get all stores
 * @throws Error if used outside StoreProvider
 */
export function useStores(): Stores {
  const stores = useContext(StoreContext);
  if (!stores) {
    throw new Error('useStores must be used within a StoreProvider');
  }
  return stores;
}

/**
 * Hook to get settings store (signal-based)
 * Returns a typed object with all settings signals and actions
 */
export function useSettings(): SettingsStoreType {
  return {
    ...SettingsStore as unknown as Partial<SettingsStoreType>,
    value: settingsSignal,
    // Legacy methods
    save: () => { /* Persistence is handled by effect */ },
    toObject: () => ({ ...settingsSignal.value }),
    reset: () => { resetSettingsStore(); },
  } as SettingsStoreType;
}

/**
 * Hook to get conversion store (signal-based)
 * Returns a typed object with all conversion signals and actions
 */
export function useConversion(): ConversionStoreType {
  return {
    ...ConversionStore as unknown as Partial<ConversionStoreType>,
    value: conversionSignal,
  } as ConversionStoreType;
}

/**
 * Hook to get LLM store (signal-based)
 * Returns a typed object with all LLM signals and actions
 */
export function useLLM(): LLMStoreType {
  const stores = useStores();
  return {
    ...LLMStore as unknown as Partial<LLMStoreType>,
    value: llmSignal,
    // Legacy method
    saveSettings: () => llmLoadSettings(stores.logs),
  } as LLMStoreType;
}

/**
 * Hook to get log store (class-based)
 */
export function useLogs(): LoggerStore {
  const stores = useStores();
  return stores.logs;
}

/**
 * Hook to get data store (class-based)
 */
export function useData(): DataStore {
  const stores = useStores();
  return stores.data;
}

/**
 * Hook to get language store (class-based)
 */
export function useLanguage(): LanguageStore {
  const stores = useStores();
  return stores.language;
}

// ============================================================================
// Store Factory
// ============================================================================

/**
 * Create all stores with default configuration
 */
export function createStores(): Stores {
  const logs = createLoggerStore();

  return {
    settings: SettingsStore,
    conversion: ConversionStore,
    llm: LLMStore,
    logs,
    data: createDataStore(),
    language: createLanguageStore(),
  };
}

/**
 * Initialize stores (load persisted state)
 */
export async function initializeStores(stores: Stores): Promise<void> {
  // Load LLM settings (async for encrypted API key)
  await LLMStore.loadSettings(stores.logs);

  // Load language preference
  stores.language.load();
}
