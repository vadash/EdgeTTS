// Stores Module
// Re-exports the store surface consumed by components and hooks

// Conversion store
export { clearTabBlocked, conversion } from './ConversionStore';
// LLM store
export { isConfigured } from './LLMStore';
// Gates
export { resumeGate, reviewGate, type ReviewDraft } from './gates';
// Settings store
export {
  patchSettings,
  settings,
  setNarratorVoice,
} from './SettingsStore';
// UI settings store
export {
  dismissNotification,
  dismissedNotifications,
} from './UISettingsStore';
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
