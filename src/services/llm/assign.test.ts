import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as assignBuilder from '@/config/prompts/assign/builder';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { createLlmStages } from './stages';
import type { LlmStageDeps, LlmStages } from './stages';

describe('LlmStages - Assign with Structured Outputs', () => {
  let service: LlmStages;
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

  function makeService(options: Partial<LlmStageDeps> = {}): LlmStages {
    let next = 0;
    return createLlmStages({
      extract: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      assign: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      merge: { apiKey: 'test-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      narratorVoice: 'narrator-voice',
      llmThreads: 2,
      useVoting: false,
      directoryHandle: null,
      logger: mockLogger,
      speakerCodeFactory: () => CODES[next++] ?? `X${next}`,
      ...options,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns speakers using structured output (sparse format)', async () => {
    const assignResponse = {
      reasoning: 'Assigning speakers to dialogue',
      assignments: {
        '0': 'A',
        '1': 'B',
      },
    };

    service = makeService({ transport: async () => assignResponse as never });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assign(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('handles sparse assignments (missing indices get narrator)', async () => {
    const assignResponse = {
      reasoning: null,
      assignments: {
        '0': 'A',
      },
    };

    service = makeService({ transport: async () => assignResponse as never });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', 'This is narration.'],
      },
    ];

    const result = await service.assign(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('narrator');
  });

  it('passes overlap sentences from previous block to processAssignBlock', async () => {
    const assignResponse = {
      reasoning: null,
      assignments: { '0': 'A' },
    };

    // Spy on buildAssignPrompt to capture the overlapSentences argument (fourth parameter).
    const spy = vi.spyOn(assignBuilder, 'buildAssignPrompt');

    service = makeService({ transport: async () => assignResponse as never });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
      {
        blockIndex: 1,
        sentenceStartIndex: 2,
        sentences: ['"How are you?" asked Alice.'],
      },
    ];

    const voiceMap = new Map<string, string>([
      ['Alice', 'voice-a'],
      ['Bob', 'voice-b'],
    ]);

    await service.assign(blocks, voiceMap, characters);

    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Block 0 has no previous block, so the first call gets no overlap.
    expect(spy.mock.calls[0][3]).toBeUndefined();

    // Block 1 gets block 0's tail as overlap. The window is the last 5 sentences, and block 0 has only 2.
    expect(spy.mock.calls[1][3]).toEqual(['"Hello," said Alice.', '"Hi," replied Bob.']);

    spy.mockRestore();
  });
});
