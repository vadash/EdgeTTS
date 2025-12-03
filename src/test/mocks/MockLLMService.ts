// Mock LLM Service
// Used for testing components that depend on LLM voice assignment

import { vi } from 'vitest';
import type {
  ILLMService,
  TextBlock,
  LLMCharacter,
  SpeakerAssignment,
  LLMProgressCallback,
} from '@/services/interfaces';

export class MockLLMService implements ILLMService {
  private cancelled = false;

  extractCharacters = vi.fn(async (
    blocks: TextBlock[],
    onProgress?: LLMProgressCallback
  ): Promise<LLMCharacter[]> => {
    if (this.cancelled) throw new Error('Cancelled');
    onProgress?.(blocks.length, blocks.length);
    return [
      { canonicalName: 'Narrator', variations: ['narrator'], gender: 'unknown' },
      { canonicalName: 'Alice', variations: ['Alice', 'alice'], gender: 'female' },
      { canonicalName: 'Bob', variations: ['Bob', 'bob'], gender: 'male' },
    ];
  });

  assignSpeakers = vi.fn(async (
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    canonicalNames: string[],
    onProgress?: LLMProgressCallback
  ): Promise<SpeakerAssignment[]> => {
    if (this.cancelled) throw new Error('Cancelled');
    onProgress?.(blocks.length, blocks.length);
    return blocks.flatMap((block, blockIndex) =>
      block.sentences.map((sentence, sentenceIndex) => ({
        sentenceIndex: block.sentenceStartIndex + sentenceIndex,
        text: sentence,
        speaker: 'Narrator',
        voiceId: characterVoiceMap.get('Narrator') || 'default-voice',
      }))
    );
  });

  cancel = vi.fn(() => {
    this.cancelled = true;
  });

  testConnection = vi.fn(async (): Promise<{ success: boolean; error?: string }> => {
    return { success: true };
  });

  // Test helpers
  setTestConnectionResult(success: boolean, error?: string): void {
    this.testConnection.mockResolvedValue({ success, error });
  }

  reset(): void {
    this.cancelled = false;
    vi.clearAllMocks();
  }
}

export function createMockLLMService(): MockLLMService {
  return new MockLLMService();
}
