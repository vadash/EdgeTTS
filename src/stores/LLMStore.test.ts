import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import {
  addCharacter,
  awaitReview,
  blockProgress,
  cancelReview,
  characterLineCounts,
  characterNames,
  confirmReview,
  getStageConfig,
  isConfigured,
  isProcessing,
  llm,
  removeCharacter,
  removeVoiceMapping,
  resetLLMStore,
  resetProcessingState,
  setBlockProgress,
  setCharacters,
  setError,
  setLoadedProfile,
  setPendingReview,
  setProcessingStatus,
  setSpeakerAssignments,
  setStageConfig,
  setStageField,
  setUseVoting,
  setVoiceMap,
  updateCharacter,
  updateVoiceMapping,
} from './LLMStore';

// Mock SecureStorage
vi.mock('@/services/SecureStorage', () => ({
  encryptValue: vi.fn((value: string) => Promise.resolve(`encrypted:${value}`)),
  decryptValue: vi.fn((value: string) => {
    if (value.startsWith('encrypted:')) {
      return Promise.resolve(value.replace('encrypted:', ''));
    }
    return Promise.resolve(value);
  }),
}));

describe('LLMStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLLMStore();
  });

  describe('initial state', () => {
    it('starts with empty API keys for all stages', () => {
      expect(llm.value.extract.apiKey).toBe('');
      expect(llm.value.merge.apiKey).toBe('');
      expect(llm.value.assign.apiKey).toBe('');
    });

    it('starts with default API URL for all stages', () => {
      expect(llm.value.extract.apiUrl).toBe('https://api.openai.com/v1');
      expect(llm.value.merge.apiUrl).toBe('https://api.openai.com/v1');
      expect(llm.value.assign.apiUrl).toBe('https://api.openai.com/v1');
    });

    it('starts with default model for all stages', () => {
      expect(llm.value.extract.model).toBe('gpt-4o-mini');
      expect(llm.value.merge.model).toBe('gpt-4o-mini');
      expect(llm.value.assign.model).toBe('gpt-4o-mini');
    });

    it('starts with idle processing status', () => {
      expect(llm.value.processingStatus).toBe('idle');
    });

    it('starts with zero block progress', () => {
      expect(llm.value.currentBlock).toBe(0);
      expect(llm.value.totalBlocks).toBe(0);
    });

    it('starts with no error', () => {
      expect(llm.value.error).toBeNull();
    });

    it('starts with empty characters', () => {
      expect(llm.value.detectedCharacters).toEqual([]);
    });

    it('starts with empty voice map', () => {
      expect(llm.value.characterVoiceMap.size).toBe(0);
    });
  });

  describe('computed properties', () => {
    describe('isConfigured', () => {
      it('returns false when no API key', () => {
        expect(isConfigured.value).toBe(false);
      });

      it('returns true when extract API key is set', () => {
        setStageField('extract', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
      });

      it('returns true when merge API key is set', () => {
        setStageField('merge', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
      });

      it('returns true when assign API key is set', () => {
        setStageField('assign', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
      });
    });

    describe('isProcessing', () => {
      it('returns false for idle', () => {
        setProcessingStatus('idle');
        expect(isProcessing.value).toBe(false);
      });

      it('returns true for extract', () => {
        setProcessingStatus('extracting');
        expect(isProcessing.value).toBe(true);
      });

      it('returns true for assign', () => {
        setProcessingStatus('assigning');
        expect(isProcessing.value).toBe(true);
      });

      it('returns false for review', () => {
        setProcessingStatus('review');
        expect(isProcessing.value).toBe(false);
      });

      it('returns false for error', () => {
        setProcessingStatus('error');
        expect(isProcessing.value).toBe(false);
      });
    });

    describe('blockProgress', () => {
      it('returns current and total blocks', () => {
        setBlockProgress(5, 10);
        expect(blockProgress.value).toEqual({ current: 5, total: 10 });
      });
    });

    describe('characterNames', () => {
      it('returns empty array when no characters', () => {
        expect(characterNames.value).toEqual([]);
      });

      it('returns character names', () => {
        const characters: LLMCharacter[] = [
          { code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] },
          { code: 'B', canonicalName: 'Bob', gender: 'male', aliases: [] },
        ];
        setCharacters(characters);
        expect(characterNames.value).toEqual(['Alice', 'Bob']);
      });
    });
  });

  describe('settings actions', () => {
    it('sets entire stage config', async () => {
      const config = {
        apiKey: 'sk-test',
        apiUrl: 'https://custom.api.com',
        model: 'gpt-4',
        streaming: false,
        reasoning: null,
        temperature: 0.5,
        topP: 0.9,
      };
      setStageConfig('extract', config);
      expect(llm.value.extract).toEqual(config);
    });

    it('gets stage config', () => {
      setStageField('extract', 'apiKey', 'sk-key');
      const config = getStageConfig('extract');
      expect(config.apiKey).toBe('sk-key');
    });

    it('sets useVoting', () => {
      setUseVoting(true);
      expect(llm.value.useVoting).toBe(true);
    });
  });

  describe('processing state actions', () => {
    it('sets error and updates status', () => {
      setError('Something went wrong');
      expect(llm.value.error).toBe('Something went wrong');
      expect(llm.value.processingStatus).toBe('error');
    });

    it('clears error without changing status', () => {
      setProcessingStatus('extracting');
      setError(null);
      expect(llm.value.error).toBeNull();
      expect(llm.value.processingStatus).toBe('extracting');
    });
  });

  describe('character data actions', () => {
    const mockCharacter: LLMCharacter = {
      code: 'A',
      canonicalName: 'Alice',
      gender: 'female',
      aliases: ['Алиса'],
    };

    it('sets characters', () => {
      setCharacters([mockCharacter]);
      expect(llm.value.detectedCharacters).toEqual([mockCharacter]);
    });

    it('adds character', () => {
      addCharacter(mockCharacter);
      expect(llm.value.detectedCharacters).toContainEqual(mockCharacter);
    });

    it('updates character', () => {
      setCharacters([mockCharacter]);
      updateCharacter(0, { canonicalName: 'Alicia' });
      expect(llm.value.detectedCharacters[0].canonicalName).toBe('Alicia');
    });

    it('does not update character at invalid index', () => {
      setCharacters([mockCharacter]);
      updateCharacter(5, { canonicalName: 'Changed' });
      expect(llm.value.detectedCharacters[0].canonicalName).toBe('Alice');
    });

    it('removes character', () => {
      setCharacters([mockCharacter]);
      removeCharacter(0);
      expect(llm.value.detectedCharacters).toEqual([]);
    });
  });

  describe('voice map actions', () => {
    it('sets voice map', () => {
      const map = new Map([
        ['Alice', 'voice-1'],
        ['Bob', 'voice-2'],
      ]);
      setVoiceMap(map);
      expect(llm.value.characterVoiceMap.get('Alice')).toBe('voice-1');
      expect(llm.value.characterVoiceMap.get('Bob')).toBe('voice-2');
    });

    it('updates voice mapping', () => {
      updateVoiceMapping('Alice', 'voice-1');
      expect(llm.value.characterVoiceMap.get('Alice')).toBe('voice-1');
    });

    it('removes voice mapping', () => {
      updateVoiceMapping('Alice', 'voice-1');
      removeVoiceMapping('Alice');
      expect(llm.value.characterVoiceMap.has('Alice')).toBe(false);
    });
  });

  describe('speakerAssignments', () => {
    it('starts with empty assignments', () => {
      expect(llm.value.speakerAssignments).toEqual([]);
    });

    it('sets speaker assignments', () => {
      const assignments = [
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
        { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'voice-2' },
      ];
      setSpeakerAssignments(assignments);
      expect(llm.value.speakerAssignments).toEqual(assignments);
    });

    it('resets assignments on resetProcessingState', () => {
      setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
      ]);
      resetProcessingState();
      expect(llm.value.speakerAssignments).toEqual([]);
    });

    describe('characterLineCounts', () => {
      it('returns empty map when no assignments', () => {
        expect(characterLineCounts.value.size).toBe(0);
      });

      it('counts lines per character', () => {
        setSpeakerAssignments([
          { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'v1' },
          { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'v2' },
          { sentenceIndex: 2, text: 'Hey', speaker: 'John', voiceId: 'v1' },
          { sentenceIndex: 3, text: 'Yo', speaker: 'John', voiceId: 'v1' },
        ]);
        const counts = characterLineCounts.value;
        expect(counts.get('John')).toBe(3);
        expect(counts.get('Mary')).toBe(1);
      });

      it('excludes narrator from counts', () => {
        setSpeakerAssignments([
          { sentenceIndex: 0, text: 'Narration', speaker: 'narrator', voiceId: 'v0' },
          { sentenceIndex: 1, text: 'Hello', speaker: 'John', voiceId: 'v1' },
        ]);
        const counts = characterLineCounts.value;
        expect(counts.has('narrator')).toBe(false);
        expect(counts.get('John')).toBe(1);
      });
    });
  });

  describe('voice review', () => {
    it('sets pending review', () => {
      setPendingReview(true);
      expect(llm.value.pendingReview).toBe(true);
      expect(llm.value.processingStatus).toBe('review');
    });

    it('resolves awaitReview when confirmed', async () => {
      setPendingReview(true);
      const promise = awaitReview();
      confirmReview();
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects awaitReview when cancelled', async () => {
      setPendingReview(true);
      const promise = awaitReview();
      cancelReview();
      await expect(promise).rejects.toThrow('Voice review cancelled');
    });
  });

  describe('state management', () => {
    it('resets processing state but keeps settings', () => {
      setStageField('extract', 'apiKey', 'sk-key');
      setProcessingStatus('extracting');
      setBlockProgress(5, 10);
      setError('Error');
      setCharacters([{ code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] }]);
      updateVoiceMapping('Alice', 'voice-1');

      resetProcessingState();

      expect(llm.value.processingStatus).toBe('idle');
      expect(llm.value.currentBlock).toBe(0);
      expect(llm.value.totalBlocks).toBe(0);
      expect(llm.value.error).toBeNull();
      expect(llm.value.detectedCharacters).toEqual([]);
      expect(llm.value.characterVoiceMap.size).toBe(0);
      // Settings preserved
      expect(llm.value.extract.apiKey).toBe('sk-key');
    });

    it('full reset clears everything', () => {
      setStageField('extract', 'apiKey', 'sk-key');
      setStageField('extract', 'apiUrl', 'https://custom.api.com');
      setStageField('extract', 'model', 'gpt-4');
      setProcessingStatus('extracting');

      resetLLMStore();

      expect(llm.value.extract.apiKey).toBe('');
      expect(llm.value.extract.apiUrl).toBe('https://api.openai.com/v1');
      expect(llm.value.extract.model).toBe('gpt-4o-mini');
      expect(llm.value.processingStatus).toBe('idle');
    });
  });

  describe('loaded profile', () => {
    it('sets loaded profile', () => {
      const profile = { name: 'test', characters: [], voiceMap: {} } as any;
      setLoadedProfile(profile);
      expect(llm.value.loadedProfile).toBe(profile);
    });

    it('can clear loaded profile', () => {
      const profile = { name: 'test', characters: [], voiceMap: {} } as any;
      setLoadedProfile(profile);
      setLoadedProfile(null);
      expect(llm.value.loadedProfile).toBeNull();
    });
  });
});
