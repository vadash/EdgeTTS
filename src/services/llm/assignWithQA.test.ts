import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';

describe('LLMVoiceService - Assign with QA Pass', () => {
  let service: LLMVoiceService;
  const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  // Sequential codes matching the canned LLM responses: canonicalNames first,
  // then MALE_UNNAMED / FEMALE_UNNAMED / UNKNOWN_UNNAMED.
  const CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  function makeService(
    run: (call: number) => Promise<unknown>,
    options: Partial<ConstructorParameters<typeof LLMVoiceService>[0]> = {},
  ) {
    let next = 0;
    let call = 0;
    const transport = vi.fn(async () => {
      call++;
      const value = await run(call);
      return value as never;
    });
    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      logger: mockLogger,
      speakerCodeFactory: () => CODES[next++] ?? `X${next}`,
      transport,
      ...options,
    });
    return transport;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs QA pass when useVoting is enabled and corrects assignments', async () => {
    // First call (draft) - contains a vocative trap error
    const draftResponse = {
      reasoning: 'Assigning speakers',
      assignments: {
        '0': 'A', // Alice says "Hello Bob" - WRONG, this is vocative trap
        '1': 'B',
      },
    };

    // Second call (QA) - corrects the error
    const qaResponse = {
      reasoning: 'Fixed vocative trap: Bob is listener in [0]',
      assignments: {
        '0': 'B', // Corrected: Bob is speaking TO Alice
        '1': 'A', // Alice responds
      },
    };

    const transport = makeService(async (call) => (call === 1 ? draftResponse : qaResponse), {
      useVoting: true, // Enable QA pass
    });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello Bob," said Alice.', '"Hi Alice," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made 2 API calls (draft + QA)
    expect(transport).toHaveBeenCalledTimes(2);

    // Result should use QA-corrected assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Bob'); // Corrected by QA
    expect(result[1].speaker).toBe('Alice');
  });

  it('falls back to draft when QA pass fails', async () => {
    const draftResponse = {
      reasoning: 'Draft assignments',
      assignments: {
        '0': 'A',
        '1': 'B',
      },
    };

    const transport = makeService(
      async (call) => {
        if (call === 1) return draftResponse;
        throw new Error('QA pass failed');
      },
      { useVoting: true },
    );

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have tried 2 calls (draft succeeded, QA failed)
    expect(transport).toHaveBeenCalledTimes(2);

    // Result should use draft assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('skips QA pass when useVoting is disabled', async () => {
    const draftResponse = {
      reasoning: 'Direct assignment',
      assignments: {
        '0': 'A',
        '1': 'B',
      },
    };

    const transport = makeService(async () => draftResponse, { useVoting: false });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made only 1 API call
    expect(transport).toHaveBeenCalledTimes(1);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });
});
