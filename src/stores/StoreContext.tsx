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

// Re-export the store modules as types for convenient access
export type SettingsStoreType = typeof SettingsStore & {
  value: ReturnType<typeof settingsSignal>;
  save: () => void;
  toObject: () => import('@/state/types').AppSettings;
  reset: () => void;
};

export type ConversionStoreType = typeof ConversionStore & {
  value: ReturnType<typeof conversionSignal>;
};

export type LLMStoreType = typeof LLMStore & {
  value: ReturnType<typeof llmSignal>;
  saveSettings: () => Promise<void>;
};

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
  const stores = useStores();
  return {
    ...stores.settings,
    value: settingsSignal,
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
