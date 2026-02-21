// Store Context for Preact
// Provides React-like context for state management

import { createContext, ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

import { LogStore } from './LogStore';
import { DataStore } from './DataStore';
import { LanguageStore } from './LanguageStore';

// Import signal-based stores
import * as SettingsStore from './SettingsStore';
import * as ConversionStore from './ConversionStore';
import * as LLMStore from './LLMStore';
import { createLogStore } from './LogStore';
import { createDataStore } from './DataStore';
import { createLanguageStore } from './LanguageStore';

// Import individual exports for typed hook return values
import {
  settings as settingsSignal,
  voice,
  narratorVoice,
  voicePoolLocale,
  enabledVoices,
  rate,
  pitch,
  ttsThreads,
  llmThreads,
  lexxRegister,
  showDopSettings,
  isLiteMode,
  statusAreaWidth,
  outputFormat,
  silenceRemovalEnabled,
  normalizationEnabled,
  deEssEnabled,
  silenceGapMs,
  eqEnabled,
  compressorEnabled,
  fadeInEnabled,
  stereoWidthEnabled,
  opusPreset,
  opusMinBitrate,
  opusMaxBitrate,
  opusCompressionLevel,
  patchSettings,
  setVoice,
  setNarratorVoice,
  setVoicePoolLocale,
  setEnabledVoices,
  setRate,
  setPitch,
  setTtsThreads,
  setLlmThreads,
  setLexxRegister,
  setShowDopSettings,
  setIsLiteMode,
  setStatusAreaWidth,
  setOutputFormat,
  setSilenceRemovalEnabled,
  setNormalizationEnabled,
  setDeEssEnabled,
  setSilenceGapMs,
  setEqEnabled,
  setCompressorEnabled,
  setFadeInEnabled,
  setStereoWidthEnabled,
  applyOpusPreset,
  setOpusMinBitrate,
  setOpusMaxBitrate,
  setOpusCompressionLevel,
} from './SettingsStore';
import {
  isProcessing,
  progress,
  progressPercent,
  elapsedTime,
  estimatedTimeRemaining,
  status,
  startTime,
  error as conversionError,
  resumeInfo,
  ffmpegLoaded,
  ffmpegLoading,
  ffmpegError,
  confirmResume,
  cancelResume,
} from './ConversionStore';
import {
  llm as llmSignal,
  isConfigured,
  characterVoiceMap,
  loadedProfile,
  pendingReview,
  detectedCharacters,
  speakerAssignments,
  processingStatus,
  error as llmError,
  extract,
  merge,
  assign,
  useVoting,
  characterNames,
  characterLineCounts,
  blockProgress,
  setUseVoting,
  setStageField,
  setStageConfig,
  getStageConfig,
  setProcessingStatus,
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  setVoiceMap,
  updateVoiceMapping,
  removeVoiceMapping,
  setSpeakerAssignments,
  setLoadedProfile,
  setPendingReview,
  awaitReview,
  confirmReview,
  cancelReview,
  resetProcessingState,
  loadSettings as llmLoadSettings,
} from './LLMStore';

// ============================================================================
// Store Types
// ============================================================================

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
  logs: LogStore;
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
export function useSettings() {
  return {
    // Root signal
    value: settingsSignal,
    // Computed values
    voice,
    narratorVoice,
    voicePoolLocale,
    enabledVoices,
    rate,
    pitch,
    ttsThreads,
    llmThreads,
    lexxRegister,
    showDopSettings,
    isLiteMode,
    statusAreaWidth,
    outputFormat,
    silenceRemovalEnabled,
    normalizationEnabled,
    deEssEnabled,
    silenceGapMs,
    eqEnabled,
    compressorEnabled,
    fadeInEnabled,
    stereoWidthEnabled,
    opusPreset,
    opusMinBitrate,
    opusMaxBitrate,
    opusCompressionLevel,
    // Actions
    patchSettings,
    setVoice,
    setNarratorVoice,
    setVoicePoolLocale,
    setEnabledVoices,
    setRate,
    setPitch,
    setTtsThreads,
    setLlmThreads,
    setLexxRegister,
    setShowDopSettings,
    setIsLiteMode,
    setStatusAreaWidth,
    setOutputFormat,
    setSilenceRemovalEnabled,
    setNormalizationEnabled,
    setDeEssEnabled,
    setSilenceGapMs,
    setEqEnabled,
    setCompressorEnabled,
    setFadeInEnabled,
    setStereoWidthEnabled,
    setOpusPreset: applyOpusPreset, // Alias for backward compatibility
    applyOpusPreset,
    setOpusMinBitrate,
    setOpusMaxBitrate,
    setOpusCompressionLevel,
    // Legacy methods
    save: () => { /* Persistence is handled by effect */ },
    toObject: () => ({ ...settingsSignal.value }),
    reset: () => { SettingsStore.resetSettingsStore(); },
  };
}

/**
 * Hook to get conversion store (signal-based)
 * Returns a typed object with all conversion signals and actions
 */
export function useConversion() {
  return {
    // Root signal
    value: ConversionStore.conversion,
    // Computed values
    isProcessing,
    progress,
    progressPercent,
    elapsedTime,
    estimatedTimeRemaining,
    status,
    startTime,
    error: conversionError,
    resumeInfo,
    ffmpegLoaded,
    ffmpegLoading,
    ffmpegError,
    // Actions
    startConversion: ConversionStore.startConversion,
    setStatus: ConversionStore.setStatus,
    updateProgress: ConversionStore.updateProgress,
    incrementProgress: ConversionStore.incrementProgress,
    setTotal: ConversionStore.setTotal,
    setError: ConversionStore.setError,
    complete: ConversionStore.complete,
    cancel: ConversionStore.cancel,
    resetConversionStore: ConversionStore.resetConversionStore,
    setFFmpegLoaded: ConversionStore.setFFmpegLoaded,
    setFFmpegLoading: ConversionStore.setFFmpegLoading,
    setFFmpegError: ConversionStore.setFFmpegError,
    awaitResumeConfirmation: ConversionStore.awaitResumeConfirmation,
    confirmResume,
    cancelResume,
  };
}

/**
 * Hook to get LLM store (signal-based)
 * Returns a typed object with all LLM signals and actions
 */
export function useLLM() {
  const stores = useStores();
  return {
    // Root signal
    value: llmSignal,
    // Computed values
    isConfigured,
    characterVoiceMap,
    loadedProfile,
    pendingReview,
    detectedCharacters,
    speakerAssignments,
    processingStatus,
    error: llmError,
    extract,
    merge,
    assign,
    useVoting,
    characterNames,
    characterLineCounts,
    blockProgress,
    // Actions
    setUseVoting,
    setStageField,
    setStageConfig,
    getStageConfig,
    setProcessingStatus,
    setCharacters,
    addCharacter,
    updateCharacter,
    removeCharacter,
    setVoiceMap,
    updateVoiceMapping,
    removeVoiceMapping,
    setSpeakerAssignments,
    setLoadedProfile,
    setPendingReview,
    awaitReview,
    confirmReview,
    cancelReview,
    resetProcessingState,
    // Legacy method
    saveSettings: () => llmLoadSettings(stores.logs),
  };
}

/**
 * Hook to get log store (class-based)
 */
export function useLogs(): LogStore {
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
  const logs = createLogStore();

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
