// Mock TTS Service
// Used for testing components that depend on TTS functionality

import { vi } from 'vitest';
import type { ITTSService } from '@/services/interfaces';

export class MockTTSService implements ITTSService {
  start = vi.fn();
  clear = vi.fn();
}

export function createMockTTSService(): MockTTSService {
  return new MockTTSService();
}
