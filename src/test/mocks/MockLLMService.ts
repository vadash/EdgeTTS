// Mock LLM stages (LlmStages record shape, ADR 0015)

import { vi } from 'vitest';
import type { LlmStages, StageCall } from '@/services/llm/stages';
import type { LLMCharacter, SpeakerAssignment, TextBlock } from '@/state/types';

export class MockLLMService implements LlmStages {
  extract = vi.fn(async (blocks: TextBlock[], p?: StageCall): Promise<LLMCharacter[]> => {
    p?.onProgress?.(blocks.length, blocks.length);
    return [
      { canonicalName: 'Narrator', variations: ['narrator'], gender: 'unknown' },
      { canonicalName: 'Alice', variations: ['Alice', 'alice'], gender: 'female' },
      { canonicalName: 'Bob', variations: ['Bob', 'bob'], gender: 'male' },
    ];
  });

  assign = vi.fn(
    async (
      blocks: TextBlock[],
      characterVoiceMap: Map<string, string>,
      _characters: LLMCharacter[],
      p?: StageCall,
    ): Promise<SpeakerAssignment[]> => {
      p?.onProgress?.(blocks.length, blocks.length);
      return blocks.flatMap((block) =>
        block.sentences.map((sentence, sentenceIndex) => ({
          sentenceIndex: block.sentenceStartIndex + sentenceIndex,
          text: sentence,
          speaker: 'Narrator',
          voiceId: characterVoiceMap.get('Narrator') || 'default-voice',
        })),
      );
    },
  );

  merge = vi.fn(async (characters: LLMCharacter[]): Promise<LLMCharacter[]> => characters);

  testConnection = vi.fn(
    async (): Promise<{ success: boolean; error?: string; model?: string }> => {
      return { success: true, model: 'mock-model' };
    },
  );

  // Test helpers
  setTestConnectionResult(success: boolean, error?: string, model?: string): void {
    this.testConnection.mockResolvedValue({ success, error, model });
  }

  reset(): void {
    vi.clearAllMocks();
  }
}

export function createMockLLMService(): MockLLMService {
  return new MockLLMService();
}
