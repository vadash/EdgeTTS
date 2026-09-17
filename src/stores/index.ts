// Re-exports the store surface consumed by components and hooks

export { clearTabBlocked, conversion } from './ConversionStore';
export { isConfigured } from './LLMStore';
export { resumeGate, reviewGate, type ReviewDraft } from './gates';
export {
  patchSettings,
  settings,
  setNarratorVoice,
} from './SettingsStore';
export {
  dismissNotification,
  dismissedNotifications,
} from './UISettingsStore';
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
