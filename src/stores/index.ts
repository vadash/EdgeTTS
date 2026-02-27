// Stores Module
// Export all stores and related functionality

// Store classes (for LogStore, DataStore, LanguageStore which are still class-based)
export type { LoggerStore } from '@/services/Logger';
export { createLoggerStore } from '@/services/Logger';
// Store types
export type { ConversionError, ConversionStatus, Progress, ResumeInfo } from './ConversionStore';
export * as ConversionStoreModule from './ConversionStore';
export {
  cancel,
  cancelResume,
  complete,
  // Resume functions
  confirmResume,
  conversion,
  elapsedTime,
  error as conversionError,
  estimatedTimeRemaining,
  ffmpegError,
  ffmpegLoaded,
  ffmpegLoading,
  isProcessing,
  // Computed values
  progress,
  progressPercent,
  resetConversionStore,
  resumeInfo,
  setError,
  setStatus,
  startConversion,
  startTime,
  status,
  updateProgress,
} from './ConversionStore';
export { createDataStore, DataStore } from './DataStore';
export type { SupportedLocale } from './LanguageStore';
export { createLanguageStore, LanguageStore } from './LanguageStore';
export type { LLMProcessingStatus } from './LLMStore';
export * as LLMStoreModule from './LLMStore';
export {
  addCharacter,
  assign,
  awaitReview,
  cancelReview,
  // Computed values
  characterVoiceMap,
  confirmReview,
  detectedCharacters,
  error as llmError,
  extract,
  getStageConfig,
  isConfigured,
  isProcessing as llmIsProcessing,
  llm,
  loadedProfile,
  merge,
  pendingReview,
  processingStatus,
  removeCharacter,
  removeVoiceMapping,
  resetProcessingState,
  setCharacters,
  setLoadedProfile,
  setPendingReview,
  setProcessingStatus,
  setSpeakerAssignments,
  setStageConfig,
  setStageField,
  // Other functions
  setUseVoting,
  setVoiceMap,
  speakerAssignments,
  updateCharacter,
  updateVoiceMapping,
  useVoting,
} from './LLMStore';
// Signal-based stores - export entire modules
export * as SettingsStoreModule from './SettingsStore';
// Re-export commonly used items from signal stores for convenience
export {
  applyOpusPreset,
  compressorEnabled,
  deEssEnabled,
  enabledVoices,
  eqEnabled,
  fadeInEnabled,
  isLiteMode,
  lexxRegister,
  llmThreads,
  narratorVoice,
  normalizationEnabled,
  opusCompressionLevel,
  opusMaxBitrate,
  opusMinBitrate,
  opusPreset,
  outputFormat,
  patchSettings,
  pitch,
  pitchDisplay,
  rate,
  rateDisplay,
  resetSettings,
  resetSettingsStore,
  setCompressorEnabled,
  setDeEssEnabled,
  setEnabledVoices,
  setEqEnabled,
  setFadeInEnabled,
  setIsLiteMode,
  setLexxRegister,
  setLlmThreads,
  setNarratorVoice,
  setNormalizationEnabled,
  setOpusCompressionLevel,
  setOpusMaxBitrate,
  setOpusMinBitrate,
  setOutputFormat,
  setPitch,
  setRate,
  setShowDopSettings,
  setSilenceGapMs,
  setSilenceRemovalEnabled,
  setStatusAreaWidth,
  setStereoWidthEnabled,
  setTtsThreads,
  settings,
  // Individual setters
  setVoice,
  setVoicePoolLocale,
  showDopSettings,
  silenceGapMs,
  silenceRemovalEnabled,
  statusAreaWidth,
  stereoWidthEnabled,
  ttsThreads,
  // Computed values
  voice,
  voicePoolLocale,
} from './SettingsStore';
// Context and hooks
export {
  createStores,
  initializeStores,
  StoreProvider,
  type Stores,
  useConversion,
  useData,
  useLanguage,
  useLLM,
  useLogs,
  useSettings,
  useStores,
} from './StoreContext';
