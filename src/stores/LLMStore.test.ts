import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMStore, createLLMStore, type LLMProcessingStatus } from './LLMStore';
import { LogStore, createLogStore } from './LogStore';
import type { LLMCharacter } from '@/state/types';
import { StorageKeys } from '@/config/storage';

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
  let store: LLMStore;
  let logStore: LogStore;

  beforeEach(() => {
    localStorage.clear();
    logStore = createLogStore();
    store = createLLMStore(logStore);
  });

  describe('initial state', () => {
    it('starts with empty API keys for all stages', () => {
      expect(store.extract.value.apiKey).toBe('');
      expect(store.merge.value.apiKey).toBe('');
      expect(store.assign.value.apiKey).toBe('');
    });

    it('starts with default API URL for all stages', () => {
      expect(store.extract.value.apiUrl).toBe('https://api.openai.com/v1');
      expect(store.merge.value.apiUrl).toBe('https://api.openai.com/v1');
      expect(store.assign.value.apiUrl).toBe('https://api.openai.com/v1');
    });

    it('starts with default model for all stages', () => {
      expect(store.extract.value.model).toBe('gpt-4o-mini');
      expect(store.merge.value.model).toBe('gpt-4o-mini');
      expect(store.assign.value.model).toBe('gpt-4o-mini');
    });

    it('starts with idle processing status', () => {
      expect(store.processingStatus.value).toBe('idle');
    });

    it('starts with zero block progress', () => {
      expect(store.currentBlock.value).toBe(0);
      expect(store.totalBlocks.value).toBe(0);
    });

    it('starts with no error', () => {
      expect(store.error.value).toBeNull();
    });

    it('starts with empty characters', () => {
      expect(store.detectedCharacters.value).toEqual([]);
    });

    it('starts with empty voice map', () => {
      expect(store.characterVoiceMap.value.size).toBe(0);
    });
  });

  describe('computed properties', () => {
    describe('isConfigured', () => {
      it('returns false when no API key', () => {
        expect(store.isConfigured.value).toBe(false);
      });

      it('returns true when extract API key is set', () => {
        store.setStageField('extract', 'apiKey', 'sk-test-key');
        expect(store.isConfigured.value).toBe(true);
      });

      it('returns true when merge API key is set', () => {
        store.setStageField('merge', 'apiKey', 'sk-test-key');
        expect(store.isConfigured.value).toBe(true);
      });

      it('returns true when assign API key is set', () => {
        store.setStageField('assign', 'apiKey', 'sk-test-key');
        expect(store.isConfigured.value).toBe(true);
      });
    });

    describe('isProcessing', () => {
      it('returns false for idle', () => {
        store.setProcessingStatus('idle');
        expect(store.isProcessing.value).toBe(false);
      });

      it('returns true for extract', () => {
        store.setProcessingStatus('extracting');
        expect(store.isProcessing.value).toBe(true);
      });

      it('returns true for assign', () => {
        store.setProcessingStatus('assigning');
        expect(store.isProcessing.value).toBe(true);
      });

      it('returns false for review', () => {
        store.setProcessingStatus('review');
        expect(store.isProcessing.value).toBe(false);
      });

      it('returns false for error', () => {
        store.setProcessingStatus('error');
        expect(store.isProcessing.value).toBe(false);
      });
    });

    describe('blockProgress', () => {
      it('returns current and total blocks', () => {
        store.setBlockProgress(5, 10);
        expect(store.blockProgress.value).toEqual({ current: 5, total: 10 });
      });
    });

    describe('characterNames', () => {
      it('returns empty array when no characters', () => {
        expect(store.characterNames.value).toEqual([]);
      });

      it('returns character names', () => {
        const characters: LLMCharacter[] = [
          { code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] },
          { code: 'B', canonicalName: 'Bob', gender: 'male', aliases: [] },
        ];
        store.setCharacters(characters);
        expect(store.characterNames.value).toEqual(['Alice', 'Bob']);
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
      store.setStageConfig('extract', config);
      expect(store.extract.value).toEqual(config);
    });
  });

  describe('processing state actions', () => {
    it('sets error and updates status', () => {
      store.setError('Something went wrong');
      expect(store.error.value).toBe('Something went wrong');
      expect(store.processingStatus.value).toBe('error');
    });

    it('clears error without changing status', () => {
      store.setProcessingStatus('extracting');
      store.setError(null);
      expect(store.error.value).toBeNull();
      expect(store.processingStatus.value).toBe('extracting');
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
      store.setCharacters([mockCharacter]);
      expect(store.detectedCharacters.value).toEqual([mockCharacter]);
    });

    it('adds character', () => {
      store.addCharacter(mockCharacter);
      expect(store.detectedCharacters.value).toContainEqual(mockCharacter);
    });

    it('updates character', () => {
      store.setCharacters([mockCharacter]);
      store.updateCharacter(0, { canonicalName: 'Alicia' });
      expect(store.detectedCharacters.value[0].canonicalName).toBe('Alicia');
    });

    it('does not update character at invalid index', () => {
      store.setCharacters([mockCharacter]);
      store.updateCharacter(5, { canonicalName: 'Changed' });
      expect(store.detectedCharacters.value[0].canonicalName).toBe('Alice');
    });

    it('removes character', () => {
      store.setCharacters([mockCharacter]);
      store.removeCharacter(0);
      expect(store.detectedCharacters.value).toEqual([]);
    });
  });

  describe('voice map actions', () => {
    it('sets voice map', () => {
      const map = new Map([['Alice', 'voice-1'], ['Bob', 'voice-2']]);
      store.setVoiceMap(map);
      expect(store.characterVoiceMap.value.get('Alice')).toBe('voice-1');
      expect(store.characterVoiceMap.value.get('Bob')).toBe('voice-2');
    });

    it('updates voice mapping', () => {
      store.updateVoiceMapping('Alice', 'voice-1');
      expect(store.characterVoiceMap.value.get('Alice')).toBe('voice-1');
    });

    it('removes voice mapping', () => {
      store.updateVoiceMapping('Alice', 'voice-1');
      store.removeVoiceMapping('Alice');
      expect(store.characterVoiceMap.value.has('Alice')).toBe(false);
    });
  });

  describe('state management', () => {
    it('resets processing state but keeps settings', () => {
      store.setStageField('extract', 'apiKey', 'sk-key');
      store.setProcessingStatus('extracting');
      store.setBlockProgress(5, 10);
      store.setError('Error');
      store.setCharacters([{ code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] }]);
      store.updateVoiceMapping('Alice', 'voice-1');

      store.resetProcessingState();

      expect(store.processingStatus.value).toBe('idle');
      expect(store.currentBlock.value).toBe(0);
      expect(store.totalBlocks.value).toBe(0);
      expect(store.error.value).toBeNull();
      expect(store.detectedCharacters.value).toEqual([]);
      expect(store.characterVoiceMap.value.size).toBe(0);
      // Settings preserved
      expect(store.extract.value.apiKey).toBe('sk-key');
    });

    it('full reset clears everything', () => {
      store.setStageField('extract', 'apiKey', 'sk-key');
      store.setStageField('extract', 'apiUrl', 'https://custom.api.com');
      store.setStageField('extract', 'model', 'gpt-4');
      store.setProcessingStatus('extracting');

      store.reset();

      expect(store.extract.value.apiKey).toBe('');
      expect(store.extract.value.apiUrl).toBe('https://api.openai.com/v1');
      expect(store.extract.value.model).toBe('gpt-4o-mini');
      expect(store.processingStatus.value).toBe('idle');
    });
  });

  describe('persistence', () => {
    it('saves settings to localStorage', async () => {
      store.setStageField('extract', 'apiKey', 'sk-test');
      store.setStageField('extract', 'apiUrl', 'https://custom.api.com');
      store.setStageField('extract', 'model', 'gpt-4');

      await store.saveSettings();

      const saved = localStorage.getItem(StorageKeys.llmSettings);
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.extract.apiKey).toBe('encrypted:sk-test');
      expect(parsed.extract.apiUrl).toBe('https://custom.api.com');
      expect(parsed.extract.model).toBe('gpt-4');
    });

    it('loads settings from localStorage', async () => {
      localStorage.setItem(StorageKeys.llmSettings, JSON.stringify({
        useVoting: false,
        extract: {
          apiKey: 'encrypted:sk-loaded',
          apiUrl: 'https://loaded.api.com',
          model: 'gpt-3.5-turbo',
          streaming: true,
          reasoning: null,
          temperature: 0.0,
          topP: 0.95,
        },
        merge: {
          apiKey: '',
          apiUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          streaming: true,
          reasoning: null,
          temperature: 0.0,
          topP: 0.95,
        },
        assign: {
          apiKey: '',
          apiUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          streaming: true,
          reasoning: null,
          temperature: 0.0,
          topP: 0.95,
        },
      }));

      await store.loadSettings();

      expect(store.extract.value.apiKey).toBe('sk-loaded');
      expect(store.extract.value.apiUrl).toBe('https://loaded.api.com');
      expect(store.extract.value.model).toBe('gpt-3.5-turbo');
    });

    it('uses defaults for missing settings', async () => {
      localStorage.setItem(StorageKeys.llmSettings, JSON.stringify({
        extract: {},
        merge: {},
        assign: {},
      }));

      await store.loadSettings();

      expect(store.extract.value.apiKey).toBe('');
      expect(store.extract.value.apiUrl).toBe('https://api.openai.com/v1');
      expect(store.extract.value.model).toBe('gpt-4o-mini');
    });

    it('handles missing localStorage gracefully', async () => {
      await store.loadSettings();
      // Should not throw and keep defaults
    });
  });

  describe('speakerAssignments', () => {
    it('starts with empty assignments', () => {
      expect(store.speakerAssignments.value).toEqual([]);
    });

    it('sets speaker assignments', () => {
      const assignments = [
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
        { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'voice-2' },
      ];
      store.setSpeakerAssignments(assignments);
      expect(store.speakerAssignments.value).toEqual(assignments);
    });

    it('resets assignments on resetProcessingState', () => {
      store.setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
      ]);
      store.resetProcessingState();
      expect(store.speakerAssignments.value).toEqual([]);
    });

    describe('characterLineCounts', () => {
      it('returns empty map when no assignments', () => {
        expect(store.characterLineCounts.value.size).toBe(0);
      });

      it('counts lines per character', () => {
        store.setSpeakerAssignments([
          { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'v1' },
          { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'v2' },
          { sentenceIndex: 2, text: 'Hey', speaker: 'John', voiceId: 'v1' },
          { sentenceIndex: 3, text: 'Yo', speaker: 'John', voiceId: 'v1' },
        ]);
        const counts = store.characterLineCounts.value;
        expect(counts.get('John')).toBe(3);
        expect(counts.get('Mary')).toBe(1);
      });

      it('excludes narrator from counts', () => {
        store.setSpeakerAssignments([
          { sentenceIndex: 0, text: 'Narration', speaker: 'narrator', voiceId: 'v0' },
          { sentenceIndex: 1, text: 'Hello', speaker: 'John', voiceId: 'v1' },
        ]);
        const counts = store.characterLineCounts.value;
        expect(counts.has('narrator')).toBe(false);
        expect(counts.get('John')).toBe(1);
      });
    });
  });
});
