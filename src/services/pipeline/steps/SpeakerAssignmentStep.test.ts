import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeakerAssignmentStep, createSpeakerAssignmentStep } from './SpeakerAssignmentStep';
import { createMockLLMService } from '@/test/mocks/MockLLMService';
import { createTestContext, createNeverAbortSignal, createTestAbortController, collectProgress, createContextWithVoiceMap } from '@/test/pipeline/helpers';
import type { ITextBlockSplitter, TextBlock, LLMCharacter } from '@/services/interfaces';

describe('SpeakerAssignmentStep', () => {
  let step: SpeakerAssignmentStep;
  let mockLLMService: ReturnType<typeof createMockLLMService>;
  let mockTextBlockSplitter: ITextBlockSplitter;

  const testCharacters: LLMCharacter[] = [
    { canonicalName: 'Narrator', gender: 'unknown', variations: ['Narrator'] },
    { canonicalName: 'Alice', gender: 'female', variations: ['Alice'] },
  ];

  const testVoiceMap = new Map([
    ['Narrator', 'voice-narrator'],
    ['Alice', 'voice-alice'],
  ]);

  const createMockSplitter = (blocks: TextBlock[]): ITextBlockSplitter => ({
    createPass1Blocks: vi.fn(() => blocks),
    createPass2Blocks: vi.fn(() => blocks),
    splitIntoSentences: vi.fn((text: string) => text.split('. ').filter(Boolean)),
  });

  beforeEach(() => {
    mockLLMService = createMockLLMService();
    mockTextBlockSplitter = createMockSplitter([
      {
        startIndex: 0,
        sentenceStartIndex: 0,
        text: 'Alice said hello.',
        sentences: ['Alice said hello.'],
      },
      {
        startIndex: 1,
        sentenceStartIndex: 1,
        text: 'The narrator continued.',
        sentences: ['The narrator continued.'],
      },
    ]);

    step = createSpeakerAssignmentStep({
      llmOptions: { apiKey: 'test-key', apiUrl: 'https://api.test.com', model: 'gpt-4' },
      createLLMService: () => mockLLMService,
      textBlockSplitter: mockTextBlockSplitter,
    });
  });

  describe('name', () => {
    it('has correct step name', () => {
      expect(step.name).toBe('speaker-assignment');
    });
  });

  describe('execute', () => {
    it('assigns speakers to sentences', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap, {
        text: 'Alice said hello. The narrator continued.',
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.assignments).toBeDefined();
      expect(result.assignments!.length).toBeGreaterThan(0);
    });

    it('calls LLM service with correct parameters', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap, {
        text: 'Test text.',
      });

      await step.execute(context, createNeverAbortSignal());

      expect(mockLLMService.assignSpeakers).toHaveBeenCalled();
      const [blocks, voiceMap, characters] = mockLLMService.assignSpeakers.mock.calls[0];
      expect(blocks).toHaveLength(2);
      expect(voiceMap).toBe(testVoiceMap);
      expect(characters).toEqual(testCharacters);
    });

    it('preserves existing context properties', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap, {
        text: 'Original text.',
        fileNames: [['chapter1', 0]],
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.fileNames).toEqual([['chapter1', 0]]);
      expect(result.characters).toEqual(testCharacters);
      expect(result.voiceMap).toBe(testVoiceMap);
    });

    it('uses text block splitter for pass2 blocks', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap, {
        text: 'Some dialogue text.',
      });

      await step.execute(context, createNeverAbortSignal());

      expect(mockTextBlockSplitter.createPass2Blocks).toHaveBeenCalledWith('Some dialogue text.');
    });
  });

  describe('missing prerequisites', () => {
    it('throws when characters missing', async () => {
      const context = createTestContext({
        voiceMap: testVoiceMap,
      });

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow("requires 'characters'");
    });

    it('throws when voiceMap missing', async () => {
      const context = createTestContext({
        characters: testCharacters,
      });

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow("requires 'voiceMap'");
    });
  });

  describe('progress reporting', () => {
    it('reports progress during assignment', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap);
      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
      expect(progress.some(p => p.message.includes('block'))).toBe(true);
    });

    it('reports final sentence count', async () => {
      const context = createContextWithVoiceMap(testCharacters, testVoiceMap);
      const { progress } = await collectProgress(step, context);

      const finalProgress = progress[progress.length - 1];
      expect(finalProgress.message).toContain('sentence');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      const context = createContextWithVoiceMap(testCharacters, testVoiceMap);
      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });

    it('cancels LLM service when aborted', async () => {
      const controller = createTestAbortController();

      // Make assignment never complete naturally
      mockLLMService.assignSpeakers.mockImplementation(async () => {
        return new Promise((_, reject) => {
          // Reject when cancelled
          const checkCancelled = setInterval(() => {
            if (mockLLMService.cancel.mock.calls.length > 0) {
              clearInterval(checkCancelled);
              reject(new Error('Cancelled'));
            }
          }, 10);
        });
      });

      const context = createContextWithVoiceMap(testCharacters, testVoiceMap);
      const promise = step.execute(context, controller.signal);

      // Abort during execution
      await new Promise(resolve => setTimeout(resolve, 20));
      controller.abort();

      await expect(promise).rejects.toThrow();
      expect(mockLLMService.cancel).toHaveBeenCalled();
    });
  });
});
