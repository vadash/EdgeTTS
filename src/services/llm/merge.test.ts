import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';

describe('LLMVoiceService - Merge with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const testCharacters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice', 'Al'], gender: 'female' },
    { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges characters using structured output', async () => {
    const mergeResponse = {
      reasoning: 'Alice and Alicia are the same person',
      merges: [[0, 1]], // Merge Alice (0) and Alicia (1)
    };

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger,
      transport: async () => mergeResponse as never,
    });

    const result = await service.mergeCharacters(testCharacters);

    // After merging 0 and 1, we should have 2 characters (Alice/Alicia merged, Bob separate)
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('handles empty merges (no duplicates)', async () => {
    const mergeResponse = {
      reasoning: null,
      merges: [], // No merges needed
    };

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger,
      transport: async () => mergeResponse as never,
    });

    const result = await service.mergeCharacters(testCharacters);

    // No merges means all characters remain
    expect(result).toHaveLength(testCharacters.length);
  });
});
