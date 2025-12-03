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
    rate?: number;
    pitch?: number;
    maxThreads?: number;
    outputFormat?: 'mp3' | 'opus';
  };
  conversion?: {
    status?: string;
    progress?: { current: number; total: number };
  };
  data?: {
    textContent?: string;
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

  // Apply initial state if provided
  if (options.stores?.settings) {
    const s = options.stores.settings;
    if (s.voice) stores.settings.setNarratorVoice(s.voice);
    if (s.rate !== undefined) stores.settings.setRate(s.rate);
    if (s.pitch !== undefined) stores.settings.setPitch(s.pitch);
    if (s.maxThreads !== undefined) stores.settings.setMaxThreads(s.maxThreads);
    if (s.outputFormat) stores.settings.setOutputFormat(s.outputFormat);
  }

  if (options.stores?.conversion) {
    const c = options.stores.conversion;
    if (c.progress) {
      stores.conversion.updateProgress(c.progress.current, c.progress.total);
    }
  }

  if (options.stores?.data) {
    const d = options.stores.data;
    if (d.textContent) stores.data.setTextContent(d.textContent);
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
