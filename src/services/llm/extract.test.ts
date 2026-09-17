import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import type { TextBlock } from '@/state/types';
import { RetriableError } from '@/errors';
import { createLlmStages } from './stages';
import type { LlmStageDeps, LlmStages } from './stages';

describe('LlmStages - Extract with Structured Outputs', () => {
  let service: LlmStages;
  const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

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

  it('extracts characters using structured output', async () => {
    const extractResponse = {
      reasoning: 'Found two speakers',
      characters: [
        { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' as const },
        { canonicalName: 'Bob', variations: ['Bob', 'Bobby'], gender: 'male' as const },
      ],
    };

    service = makeService({
      transport: async () => extractResponse as never,
    });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: [
          '"Hello," said Alice.',
          'Alice looked at the sky.',
          'Alice smiled.',
          '"Hi," replied Bob.',
          'Bob nodded slowly.',
          'Bob turned away.',
        ],
      },
    ];

    const result = await service.extract(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].canonicalName).toBe('Alice');
    expect(result[1].canonicalName).toBe('Bob');
  });

  it('handles null reasoning (transformed to undefined)', async () => {
    const extractResponse = {
      reasoning: null,
      characters: [
        { canonicalName: 'Narrator', variations: ['Narrator'], gender: 'unknown' as const },
      ],
    };

    service = makeService({
      transport: async () => extractResponse as never,
    });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: [
          'The story begins.',
          'Narrator spoke softly.',
          'Narrator paused.',
          'Narrator continued.',
        ],
      },
    ];

    const result = await service.extract(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Narrator');
  });

  it('skips block on refusal during extract (no backup)', async () => {
    // The transport throws the retriable refusal error. The service exhausts
    // retries, and the per-block handler skips the block.
    service = makeService({
      transport: async () => {
        throw new RetriableError('LLM refused: Content policy violation');
      },
    });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['Test content.'],
      },
    ];

    const result = await service.extract(blocks);
    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed after all retries, skipping'),
    );
  });
});
