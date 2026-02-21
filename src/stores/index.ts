// Stores Module
// Export all stores and related functionality

// Signal-based stores - export entire modules
export * as SettingsStoreModule from './SettingsStore';
export * as ConversionStoreModule from './ConversionStore';
export * as LLMStoreModule from './LLMStore';

// Store classes (for LogStore, DataStore, LanguageStore which are still class-based)
export { LogStore, createLogStore } from './LogStore';
export { DataStore, createDataStore } from './DataStore';
export { LanguageStore, createLanguageStore } from './LanguageStore';

// Store types
export type { ConversionStatus, Progress, ConversionError, ResumeInfo } from './ConversionStore';
export type { LLMProcessingStatus } from './LLMStore';
export type { SupportedLocale } from './LanguageStore';

// Context and hooks
export {
  StoreProvider,
  useStores,
  useSettings,
  useConversion,
  useLLM,
  useLogs,
  useData,
  useLanguage,
  createStores,
  initializeStores,
  type Stores,
} from './StoreContext';

// Re-export commonly used items from signal stores for convenience
export {
  settings,
  patchSettings,
  rateDisplay,
  pitchDisplay,
  resetSettings,
  resetSettingsStore,
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
  // Individual setters
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

export {
  conversion,
  startConversion,
  setStatus,
  updateProgress,
  setError,
  complete,
  cancel,
  resetConversionStore,
  isProcessing,
  progressPercent,
  elapsedTime,
  estimatedTimeRemaining,
  // Computed values
  progress,
  status,
  startTime,
  error as conversionError,
  resumeInfo,
  ffmpegLoaded,
  ffmpegLoading,
  ffmpegError,
  // Resume functions
  confirmResume,
  cancelResume,
} from './ConversionStore';

export {
  llm,
  setProcessingStatus,
  setCharacters,
  setVoiceMap,
  setSpeakerAssignments,
  setPendingReview,
  awaitReview,
  confirmReview,
  cancelReview,
  resetProcessingState,
  isConfigured,
  isProcessing as llmIsProcessing,
  // Computed values
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
  // Other functions
  setUseVoting,
  setStageField,
  setStageConfig,
  getStageConfig,
  addCharacter,
  updateCharacter,
  removeCharacter,
  updateVoiceMapping,
  removeVoiceMapping,
  setLoadedProfile,
} from './LLMStore';
