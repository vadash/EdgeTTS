// Store Context for Preact
// Provides React-like context for state management

import { type ComponentChildren, createContext } from 'preact';
import { useContext } from 'preact/hooks';

import type { LoggerStore } from '@/services/Logger';
import { createLoggerStore } from '@/services/Logger';
// Import state types
import type { AppSettings } from '@/state/types';
import * as ConversionStore from './ConversionStore';
import { conversion as conversionSignal } from './ConversionStore';
import { createDataStore, type DataStore } from './DataStore';
import { createLanguageStore, type LanguageStore } from './LanguageStore';
import * as LLMStore from './LLMStore';
import { llm as llmSignal } from './LLMStore';
// Import signal-based stores
import * as SettingsStore from './SettingsStore';
import * as UISettingsStore from './UISettingsStore';
// Import individual exports for typed hook return values
import { resetSettingsStore, settings as settingsSignal } from './SettingsStore';

// ============================================================================
// Store Types
// ============================================================================

// Store module types used as hook return values
type SettingsStoreType = typeof SettingsStore & {
  value: typeof settingsSignal;
  toObject: () => AppSettings;
  reset: () => void;
};

type ConversionStoreType = typeof ConversionStore & {
  value: typeof conversionSignal;
};

type LLMStoreType = typeof LLMStore & {
  value: typeof llmSignal;
};

/**
 * All stores combined
 * Settings, Conversion, LLM, and UISettings are signal-based (no class instances)
 * Logs, Data, and Language remain as class instances for now
 */
export interface Stores {
  // Signal-based stores (export modules)
  settings: typeof SettingsStore;
  conversion: typeof ConversionStore;
  llm: typeof LLMStore;
  uiSettings: typeof UISettingsStore;

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
  return <StoreContext.Provider value={stores}>{children}</StoreContext.Provider>;
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
  const stores = useStores();
  return {
    ...stores.settings,
    value: settingsSignal,
    toObject: () => ({ ...settingsSignal.value }),
    reset: () => {
      resetSettingsStore();
    },
  } as SettingsStoreType;
}

/**
 * Hook to get conversion store (signal-based)
 * Returns a typed object with all conversion signals and actions
 */
export function useConversion(): ConversionStoreType {
  const stores = useStores();
  return {
    ...stores.conversion,
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
    ...stores.llm,
    value: llmSignal,
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
    uiSettings: UISettingsStore,
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
