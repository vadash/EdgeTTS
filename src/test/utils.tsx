// Test Utilities
// Helper functions for rendering components in tests with all providers

import { render, RenderResult } from '@testing-library/preact';
import { IntlProvider } from 'preact-i18n';
import { ComponentChildren, VNode } from 'preact';
import { StoreProvider, createStores, Stores } from '@/stores';
import { resetLogger, resetFFmpeg } from '@/services';
import en from '@/i18n/en.json';

// Import signal-based store actions for test setup
import { patchSettings } from '@/stores/SettingsStore';
import { updateProgress } from '@/stores/ConversionStore';
import { setStageField } from '@/stores/LLMStore';

export interface TestRenderOptions {
  stores?: Partial<TestStoresState>;
  locale?: 'en' | 'ru';
}

export interface TestStoresState {
  settings?: {
    voice?: string;
    narratorVoice?: string;
    rate?: number;
    pitch?: number;
    maxThreads?: number;
    outputFormat?: 'opus';
    silenceRemovalEnabled?: boolean;
    normalizationEnabled?: boolean;
    lexxRegister?: boolean;
  };
  conversion?: {
    status?: string;
    progress?: { current: number; total: number };
  };
  data?: {
    textContent?: string;
    dictionaryRaw?: string[];
    // Note: detectedLanguage is computed from textContent, not settable directly
  };
  llm?: {
    apiUrl?: string;
    model?: string;
  };
}

export interface TestRenderResult extends RenderResult {
  stores: Stores;
}

/**
 * Render a component with all required providers for testing
 */
export function renderWithProviders(
  ui: VNode,
  options: TestRenderOptions = {}
): TestRenderResult {
  // Reset singletons before each test
  resetLogger();
  resetFFmpeg();

  const stores = createStores();

  // Apply initial settings state
  if (options.stores?.settings) {
    const s = options.stores.settings;
    const settingsPatch: Record<string, unknown> = {};
    if (s.voice !== undefined) settingsPatch.voice = s.voice;
    if (s.narratorVoice !== undefined) settingsPatch.narratorVoice = s.narratorVoice;
    if (s.rate !== undefined) settingsPatch.rate = s.rate;
    if (s.pitch !== undefined) settingsPatch.pitch = s.pitch;
    if (s.maxThreads !== undefined) settingsPatch.ttsThreads = s.maxThreads;
    if (s.outputFormat !== undefined) settingsPatch.outputFormat = s.outputFormat;
    if (s.silenceRemovalEnabled !== undefined) settingsPatch.silenceRemovalEnabled = s.silenceRemovalEnabled;
    if (s.normalizationEnabled !== undefined) settingsPatch.normalizationEnabled = s.normalizationEnabled;
    if (s.lexxRegister !== undefined) settingsPatch.lexxRegister = s.lexxRegister;
    if (Object.keys(settingsPatch).length > 0) {
      patchSettings(settingsPatch);
    }
  }

  // Apply initial conversion state
  if (options.stores?.conversion) {
    const c = options.stores.conversion;
    if (c.progress) {
      updateProgress(c.progress.current, c.progress.total);
    }
  }

  // Apply initial data state
  if (options.stores?.data) {
    const d = options.stores.data;
    if (d.textContent !== undefined) stores.data.setTextContent(d.textContent);
    if (d.dictionaryRaw !== undefined) stores.data.dictionaryRaw.value = d.dictionaryRaw;
  }

  // Apply initial LLM state
  if (options.stores?.llm) {
    const l = options.stores.llm;
    if (l.apiUrl !== undefined) {
      setStageField('extract', 'apiUrl', l.apiUrl);
      setStageField('merge', 'apiUrl', l.apiUrl);
      setStageField('assign', 'apiUrl', l.apiUrl);
    }
    if (l.model !== undefined) {
      setStageField('extract', 'model', l.model);
      setStageField('merge', 'model', l.model);
      setStageField('assign', 'model', l.model);
    }
  }

  const Wrapper = ({ children }: { children: ComponentChildren }) => (
    <StoreProvider stores={stores}>
      <IntlProvider definition={en}>
        {children}
      </IntlProvider>
    </StoreProvider>
  );

  const result = render(ui, { wrapper: Wrapper });

  return {
    ...result,
    stores,
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 50
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Condition not met within timeout');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Create a mock Uint8Array of specified length
 */
export function createMockAudio(length = 1024): Uint8Array {
  const audio = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    audio[i] = Math.floor(Math.random() * 256);
  }
  return audio;
}

/**
 * Create a mock File object
 */
export function createMockFile(
  content: string,
  name: string,
  type = 'text/plain'
): File {
  return new File([content], name, { type });
}
