import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter } from '@/state/types';
import { createLlmStages } from './stages';
import type { LlmStageDeps, LlmStages } from './stages';

describe('LlmStages - Merge with Structured Outputs', () => {
  let service: LlmStages;
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

  function makeService(overrides: Partial<LlmStageDeps> = {}): LlmStages {
    return createLlmStages({
      extract: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      assign: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      merge: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      narratorVoice: 'narrator',
      llmThreads: 2,
      useVoting: false,
      directoryHandle: null,
      logger: mockLogger,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges characters using structured output', async () => {
    const mergeResponse = {
      reasoning: 'Alice and Alicia are the same person',
      merges: [[0, 1]], // Merge Alice (0) and Alicia (1)
    };

    service = makeService({
      transport: async () => mergeResponse as never,
    });

    const result = await service.merge(testCharacters);

    // After merging 0 and 1, we should have 2 characters (Alice/Alicia merged, Bob separate)
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('handles empty merges (no duplicates)', async () => {
    const mergeResponse = {
      reasoning: null,
      merges: [], // No merges needed
    };

    service = makeService({
      transport: async () => mergeResponse as never,
    });

    const result = await service.merge(testCharacters);

    // No merges means all characters remain
    expect(result).toHaveLength(testCharacters.length);
  });
});
