import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { LLMVoiceService } from './LLMVoiceService';
import { ExtractSchema } from './schemas';
import type { TextBlock } from '@/state/types';

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

describe('LLMVoiceService - Extract with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts characters using structured output', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: 'Found two speakers',
            characters: [
              { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
              { canonicalName: 'Bob', variations: ['Bob', 'Bobby'], gender: 'male' }
            ]
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
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', '"Hi," replied Bob.']
    }];

    const result = await service.extractCharacters(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].canonicalName).toBe('Alice');
    expect(result[1].canonicalName).toBe('Bob');
  });

  it('handles null reasoning (transformed to undefined)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: null,
            characters: [
              { canonicalName: 'Narrator', variations: ['Narrator'], gender: 'unknown' }
            ]
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
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['The story begins.']
    }];

    const result = await service.extractCharacters(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Narrator');
  });

  it('throws on refusal during extract', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: null,
          refusal: 'Content policy violation'
        }
      }]
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
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['Test content.']
    }];

    await expect(service.extractCharacters(blocks)).rejects.toThrow('LLM refused');
  });
});
