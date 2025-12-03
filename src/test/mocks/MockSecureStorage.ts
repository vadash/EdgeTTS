// Mock Secure Storage
// Used for testing components that depend on encrypted storage

import { vi } from 'vitest';
import type { ISecureStorage } from '@/services/interfaces';

export class MockSecureStorage implements ISecureStorage {
  private storage = new Map<string, string>();

  saveApiKey = vi.fn(async (key: string): Promise<void> => {
    this.storage.set('apiKey', key);
  });

  loadApiKey = vi.fn(async (): Promise<string> => {
    return this.storage.get('apiKey') || '';
  });

  clearApiKey = vi.fn(async (): Promise<void> => {
    this.storage.delete('apiKey');
  });

  // Test helpers
  setApiKey(key: string): void {
    this.storage.set('apiKey', key);
  }

  getStoredApiKey(): string | undefined {
    return this.storage.get('apiKey');
  }

  reset(): void {
    this.storage.clear();
  }
}

export function createMockSecureStorage(): MockSecureStorage {
  return new MockSecureStorage();
}
