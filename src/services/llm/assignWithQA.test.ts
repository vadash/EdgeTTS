import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };
  }),
}));

describe('LLMVoiceService - Assign with QA Pass', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs QA pass when useVoting is enabled and corrects assignments', async () => {
    // First call (draft) - contains a vocative trap error
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Assigning speakers',
              assignments: {
                '0': 'A', // Alice says "Hello Bob" - WRONG, this is vocative trap
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    // Second call (QA) - corrects the error
    const qaResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Fixed vocative trap: Bob is listener in [0]',
              assignments: {
                '0': 'B', // Corrected: Bob is speaking TO Alice
                '1': 'A', // Alice responds
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    // Setup mock to return different responses for each call
    const openai = await import('openai');
    let callCount = 0;
    const mockCreate = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? draftResponse : qaResponse);
    });
    vi.mocked(openai.default).mockImplementation(
      function () {
        return {
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        } as any;
      },
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: true, // Enable QA pass
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello Bob," said Alice.', '"Hi Alice," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made 2 API calls (draft + QA)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Result should use QA-corrected assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Bob'); // Corrected by QA
    expect(result[1].speaker).toBe('Alice');
  });

  it('falls back to draft when QA pass fails', async () => {
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Draft assignments',
              assignments: {
                '0': 'A',
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    const openai = await import('openai');
    let callCount = 0;
    const mockCreate = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(draftResponse);
      }
      throw new Error('QA pass failed');
    });
    vi.mocked(openai.default).mockImplementation(
      function () {
        return {
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        } as any;
      },
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: true,
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have tried 2 calls (draft succeeded, QA failed)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Result should use draft assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('skips QA pass when useVoting is disabled', async () => {
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Direct assignment',
              assignments: {
                '0': 'A',
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(draftResponse);
    vi.mocked(openai.default).mockImplementation(
      function () {
        return {
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        } as any;
      },
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: false, // Disabled
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made only 1 API call
    expect(mockCreate).toHaveBeenCalledTimes(1);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });
});
