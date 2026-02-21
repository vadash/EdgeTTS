import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { LLMVoiceService } from './LLMVoiceService';
import { AssignSchema } from './schemas';
import type { TextBlock } from '@/state/types';
import type { LLMCharacter } from '@/state/types';

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

describe('LLMVoiceService - Assign with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns speakers using structured output (sparse format)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: 'Assigning speakers to dialogue',
            assignments: {
              '0': 'A',  // Code for Alice
              '1': 'B'   // Code for Bob
            }
          }),
          refusal: null
        }
      }],
      model: 'gpt-4o-mini'
    };

    // Setup mock before creating service
    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(mockResponse as any);
    vi.mocked(openai.default).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    } as any));

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', '"Hi," replied Bob.']
    }];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('handles sparse assignments (missing indices get narrator)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: null,
            assignments: {
              '0': 'A'  // Only sentence 0 assigned (A = Alice)
            }
          }),
          refusal: null
        }
      }],
      model: 'gpt-4o-mini'
    };

    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(mockResponse as any);
    vi.mocked(openai.default).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    } as any));

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', 'This is narration.']
    }];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('narrator');  // Unassigned gets narrator
  });

  it('validates AssignSchema structure', () => {
    const validResult = AssignSchema.safeParse({
      reasoning: 'test',
      assignments: { '0': 'A', '5': 'B' }
    });
    expect(validResult.success).toBe(true);

    const invalidResult = AssignSchema.safeParse({
      reasoning: null,
      assignments: 'not an object'
    });
    expect(invalidResult.success).toBe(false);
  });
});
