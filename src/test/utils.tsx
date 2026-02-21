// Test Utilities
// Helper functions for rendering components in tests with all providers

import { render, RenderResult } from '@testing-library/preact';
import { IntlProvider } from 'preact-i18n';
import { ComponentChildren, VNode } from 'preact';
import { StoreProvider, createStores, Stores } from '@/stores';
import { ServiceProvider } from '@/di';
import { ServiceContainer } from '@/di/ServiceContainer';
import { createTestContainer, MockServices, TestContainerOptions } from './TestServiceContainer';
import en from '@/i18n/en.json';

export interface TestRenderOptions {
  stores?: Partial<TestStoresState>;
  services?: TestContainerOptions;
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
  mocks: MockServices;
  serviceContainer: ServiceContainer;
}

/**
 * Render a component with all required providers for testing
 */
export function renderWithProviders(
  ui: VNode,
  options: TestRenderOptions = {}
): TestRenderResult {
  const stores = createStores();

  // Apply initial settings state
  if (options.stores?.settings) {
    const s = options.stores.settings;
    if (s.voice !== undefined) stores.settings.voice.value = s.voice;
    if (s.narratorVoice !== undefined) stores.settings.setNarratorVoice(s.narratorVoice);
    if (s.rate !== undefined) stores.settings.setRate(s.rate);
    if (s.pitch !== undefined) stores.settings.setPitch(s.pitch);
    if (s.maxThreads !== undefined) stores.settings.setMaxThreads(s.maxThreads);
    if (s.outputFormat !== undefined) stores.settings.setOutputFormat(s.outputFormat);
    if (s.silenceRemovalEnabled !== undefined) stores.settings.setSilenceRemovalEnabled(s.silenceRemovalEnabled);
    if (s.normalizationEnabled !== undefined) stores.settings.setNormalizationEnabled(s.normalizationEnabled);
    if (s.lexxRegister !== undefined) stores.settings.lexxRegister.value = s.lexxRegister;
  }

  // Apply initial conversion state
  if (options.stores?.conversion) {
    const c = options.stores.conversion;
    if (c.progress) {
      stores.conversion.updateProgress(c.progress.current, c.progress.total);
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
      stores.llm.extract.value = { ...stores.llm.extract.value, apiUrl: l.apiUrl };
      stores.llm.merge.value = { ...stores.llm.merge.value, apiUrl: l.apiUrl };
      stores.llm.assign.value = { ...stores.llm.assign.value, apiUrl: l.apiUrl };
    }
    if (l.model !== undefined) {
      stores.llm.extract.value = { ...stores.llm.extract.value, model: l.model };
      stores.llm.merge.value = { ...stores.llm.merge.value, model: l.model };
      stores.llm.assign.value = { ...stores.llm.assign.value, model: l.model };
    }
  }

  const { container: serviceContainer, mocks } = createTestContainer(options.services);

  const Wrapper = ({ children }: { children: ComponentChildren }) => (
    <ServiceProvider container={serviceContainer}>
      <StoreProvider stores={stores}>
        <IntlProvider definition={en}>
          {children}
        </IntlProvider>
      </StoreProvider>
    </ServiceProvider>
  );

  const result = render(ui, { wrapper: Wrapper });

  return {
    ...result,
    stores,
    mocks,
    serviceContainer,
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
