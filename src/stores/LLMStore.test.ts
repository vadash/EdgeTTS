import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@/config/storage';
import {
  characterLineCounts,
  isConfigured,
  isProcessing,
  llm,
  loadSettings,
  poolActive,
  poolEntries,
  poolError,
  poolValid,
  resetLLMStore,
  resetProcessingState,
  setBlockProgress,
  setCharacters,
  setError,
  setPoolRaw,
  setProcessingStatus,
  setSpeakerAssignments,
  setStageConfig,
  setStageField,
  setVoiceMap,
} from './LLMStore';

// Opaque reversible blobs so a persistence test can prove no key material is
// stored as plain text while loadSettings still round-trips.
vi.mock('@/services/SecureStorage', () => ({
  encryptValue: vi.fn((value: string) => Promise.resolve(value ? `enc:${btoa(value)}` : '')),
  decryptValue: vi.fn((value: string) =>
    Promise.resolve(value.startsWith('enc:') ? atob(value.slice(4)) : value),
  ),
}));

describe('LLMStore', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLLMStore();
  });

  describe('computed properties', () => {
    describe('isConfigured', () => {
      it('reflects whether any stage has an API key set', () => {
        expect(isConfigured.value).toBe(false);
        // A key on any one stage is enough, so the test checks each stage
        resetLLMStore();
        setStageField('extract', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
        resetLLMStore();
        setStageField('merge', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
        resetLLMStore();
        setStageField('assign', 'apiKey', 'sk-test-key');
        expect(isConfigured.value).toBe(true);
      });
    });

    describe('isProcessing', () => {
      it('is true only while actively processing, false for idle/review/error', () => {
        const cases: Array<[Parameters<typeof setProcessingStatus>[0], boolean]> = [
          ['idle', false],
          ['extracting', true],
          ['assigning', true],
          ['review', false],
          ['error', false],
        ];
        for (const [status, expected] of cases) {
          setProcessingStatus(status);
          expect(isProcessing.value).toBe(expected);
        }
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
        repeatPrompt: false,
        maxRetries: 3,
        corsMiddleware: '',
      };
      setStageConfig('extract', config);
      expect(llm.value.extract).toEqual(config);
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
  });

  describe('speakerAssignments', () => {
    it('resets assignments on resetProcessingState', () => {
      setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
      ]);
      resetProcessingState();
      expect(llm.value.speakerAssignments).toEqual([]);
    });

    describe('characterLineCounts', () => {
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

  describe('connection pool', () => {
    const raw = [
      JSON.stringify({ url: 'https://a.example/v1', key: 'secret-a', name: 'a' }),
      JSON.stringify({ url: 'https://a.example/v1', key: 'secret-a', name: 'a' }),
    ].join('\n');

    it('starts empty and counts a non-empty pool as configured', () => {
      expect(llm.value.poolRaw).toBe('');
      expect(isConfigured.value).toBe(false);

      setPoolRaw(raw);

      expect(isConfigured.value).toBe(true);
    });

    it('exposes parsed pool entries in source order, duplicates kept', () => {
      setPoolRaw(raw);

      expect(poolEntries.value).toHaveLength(2);
      expect(poolEntries.value.map((e) => e.name)).toEqual(['a', 'a']);
      expect(poolEntries.value[0].url).toBe('https://a.example/v1');
    });

    it('exposes no entries while the textarea has an invalid line', () => {
      setPoolRaw('{not json');

      expect(poolEntries.value).toEqual([]);
    });

    it('reports the first invalid line and never counts the draft as configured', () => {
      setPoolRaw(`${raw}\n{not json`);

      expect(poolValid.value).toBe(false);
      expect(poolError.value).toBe('Line 3: invalid JSON');
      expect(isConfigured.value).toBe(false);
      expect(poolActive.value).toBe(false);
    });

    it('treats an empty textarea as a valid, inactive pool', () => {
      expect(poolValid.value).toBe(true);
      expect(poolError.value).toBeNull();
      expect(poolActive.value).toBe(false);
      expect(isConfigured.value).toBe(false);
    });

    it('activates a valid non-empty pool', () => {
      setPoolRaw(raw);

      expect(poolValid.value).toBe(true);
      expect(poolError.value).toBeNull();
      expect(poolActive.value).toBe(true);
    });

    it('keeps a stage key configured when the pool draft is invalid', () => {
      setStageField('extract', 'apiKey', 'sk-test-key');
      setPoolRaw('{not json');

      expect(isConfigured.value).toBe(true);
      expect(poolActive.value).toBe(false);
    });

    it('persists the pool as one encrypted blob and restores it on load', async () => {
      const logStore = {
        error: vi.fn(),
      } as unknown as Parameters<typeof loadSettings>[0];

      vi.useFakeTimers();
      try {
        setPoolRaw(raw);
        await vi.advanceTimersByTimeAsync(150);
      } finally {
        vi.useRealTimers();
      }

      const stored = localStorage.getItem(StorageKeys.llmPool);
      expect(stored).toBeTruthy();
      expect(stored).not.toContain('secret-a');

      resetLLMStore();
      expect(llm.value.poolRaw).toBe('');

      await loadSettings(logStore);

      expect(llm.value.poolRaw).toBe(raw);
      expect(poolEntries.value).toHaveLength(2);
    });

    it('keeps the last valid blob when the textarea holds an invalid line', async () => {
      vi.useFakeTimers();
      try {
        setPoolRaw(raw);
        await vi.advanceTimersByTimeAsync(150);
        const validBlob = localStorage.getItem(StorageKeys.llmPool);

        setPoolRaw(`${raw}\n{not json`);
        await vi.advanceTimersByTimeAsync(150);

        expect(localStorage.getItem(StorageKeys.llmPool)).toBe(validBlob);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('state management', () => {
    it('resets processing state but keeps settings', () => {
      setStageField('extract', 'apiKey', 'sk-key');
      setProcessingStatus('extracting');
      setBlockProgress(5, 10);
      setError('Error');
      setCharacters([{ canonicalName: 'Alice', gender: 'female', variations: [] }]);
      setVoiceMap(new Map([['Alice', 'voice-1']]));

      resetProcessingState();

      expect(llm.value.processingStatus).toBe('idle');
      expect(llm.value.currentBlock).toBe(0);
      expect(llm.value.totalBlocks).toBe(0);
      expect(llm.value.error).toBeNull();
      expect(llm.value.detectedCharacters).toEqual([]);
      expect(llm.value.characterVoiceMap.size).toBe(0);
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
});
