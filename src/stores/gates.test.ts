import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancellationError } from '@/errors';
import type { LLMCharacter } from '@/state/types';
import { llm, resetLLMStore } from './LLMStore';
import { createGate, resumeGate, reviewGate, type ReviewDraft } from './gates';

vi.mock('@/services/SecureStorage', () => ({
  encryptValue: vi.fn((value: string) => Promise.resolve(`encrypted:${value}`)),
  decryptValue: vi.fn((value: string) => {
    if (value.startsWith('encrypted:')) {
      return Promise.resolve(value.replace('encrypted:', ''));
    }
    return Promise.resolve(value);
  }),
}));

const alice: LLMCharacter = { canonicalName: 'Alice', gender: 'female', variations: [] };

const draft: ReviewDraft = {
  characters: [alice],
  voiceMap: new Map([['Alice', 'voice-1']]),
  assignments: [{ sentenceIndex: 0, text: 'Hello.', speaker: 'Alice', voiceId: 'voice-1' }],
  profile: null,
  lineCounts: new Map([['Alice', 3]]),
};

describe('createGate', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLLMStore();
  });

  describe('reviewGate', () => {
    it('confirm settles open() with the outcome and writes the draft to the LLM store', async () => {
      const promise = reviewGate.open(draft);
      expect(reviewGate.state.value.open).toBe(true);
      expect(reviewGate.state.value.draft).toEqual(draft);

      reviewGate.confirm();
      const outcome = await promise;

      expect(outcome.voiceMap.get('Alice')).toBe('voice-1');
      expect(outcome.profile).toBeNull();
      expect(llm.value.detectedCharacters).toEqual([alice]);
      expect(llm.value.characterVoiceMap.get('Alice')).toBe('voice-1');
      expect(llm.value.speakerAssignments).toEqual(draft.assignments);
      expect(llm.value.loadedProfile).toBeNull();
      expect(reviewGate.state.value).toEqual({ open: false, draft: null });
    });

    it('decline rejects open() with CancellationError', async () => {
      const promise = reviewGate.open(draft);
      reviewGate.decline();
      await expect(promise).rejects.toBeInstanceOf(CancellationError);
      expect(reviewGate.state.value.open).toBe(false);
    });

    it('rejects a second open() while already open', async () => {
      const first = reviewGate.open(draft);
      await expect(reviewGate.open(draft)).rejects.toThrow();
      reviewGate.decline();
      await expect(first).rejects.toBeInstanceOf(CancellationError);
    });

    it('patch merges a partial into the open draft', async () => {
      const promise = reviewGate.open(draft);
      reviewGate.patch({ lineCounts: new Map([['Alice', 7]]) });
      expect(reviewGate.state.value.draft?.lineCounts.get('Alice')).toBe(7);
      expect(reviewGate.state.value.draft?.voiceMap.get('Alice')).toBe('voice-1');
      reviewGate.decline();
      await expect(promise).rejects.toBeInstanceOf(CancellationError);
    });
  });

  describe('resumeGate', () => {
    it('confirm resolves true and decline resolves false', async () => {
      const confirmed = resumeGate.open({ cachedChunks: 5, hasLLMState: true });
      resumeGate.confirm();
      await expect(confirmed).resolves.toBe(true);

      const declined = resumeGate.open({ cachedChunks: 5, hasLLMState: true });
      resumeGate.decline();
      await expect(declined).resolves.toBe(false);
      expect(resumeGate.state.value).toEqual({ open: false, draft: null });
    });
  });

  describe('decline error containment', () => {
    it('does not throw synchronously when io.decline throws; rejects open() instead', async () => {
      const gate = createGate<{ value: string }, string>({
        settle: (d) => d.value,
        decline: () => {
          throw new Error('decline exploded');
        },
      });
      const promise = gate.open({ value: 'x' });
      expect(() => gate.decline()).not.toThrow();
      await expect(promise).rejects.toThrow('decline exploded');
      expect(gate.state.value).toEqual({ open: false, draft: null });
    });
  });
});
