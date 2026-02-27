import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';
import { MergeSchema } from './schemas';

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('LLMVoiceService - Merge with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
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
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Alice and Alicia are the same person',
              merges: [[0, 1]], // Merge Alice (0) and Alicia (1)
            }),
            refusal: null,
          },
        },
      ],
    };

    // Setup mock before creating service
    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(mockResponse as any);
    vi.mocked(openai.default).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as any,
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger,
    });

    // Access internal merge method via the public method
    const result = await (service as any).mergeCharactersWithLLM(testCharacters);

    // After merging 0 and 1, we should have 2 characters (Alice/Alicia merged, Bob separate)
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('handles empty merges (no duplicates)', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: null,
              merges: [], // No merges needed
            }),
            refusal: null,
          },
        },
      ],
    };

    // Setup mock before creating service
    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(mockResponse as any);
    vi.mocked(openai.default).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as any,
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger,
    });

    const result = await (service as any).mergeCharactersWithLLM(testCharacters);

    // No merges means all characters remain
    expect(result).toHaveLength(testCharacters.length);
  });

  it('validates merge groups have 2+ indices', async () => {
    // Schema should reject single-element groups
    const result = MergeSchema.safeParse({
      reasoning: null,
      merges: [[0]], // Invalid: single element
    });

    expect(result.success).toBe(false);
  });
});
