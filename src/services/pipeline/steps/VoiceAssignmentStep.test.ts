import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceAssignmentStep, createVoiceAssignmentStep } from './VoiceAssignmentStep';
import { createTestContext, createNeverAbortSignal, createTestAbortController, collectProgress, createContextWithCharacters } from '@/test/pipeline/helpers';
import type { LLMCharacter, VoicePool } from '@/state/types';

describe('VoiceAssignmentStep', () => {
  let step: VoiceAssignmentStep;
  let testPool: VoicePool;

  const testCharacters: LLMCharacter[] = [
    { code: 'A', canonicalName: 'Alice', gender: 'female', variations: [] },
    { code: 'B', canonicalName: 'Bob', gender: 'male', variations: [] },
    { code: 'C', canonicalName: 'Charlie', gender: 'male', variations: ['Charles'] },
  ];

  beforeEach(() => {
    testPool = {
      male: ['male-1', 'male-2', 'male-3'],
      female: ['female-1', 'female-2', 'female-3'],
    };

    step = createVoiceAssignmentStep({
      narratorVoice: 'narrator-voice-id',
      pool: testPool,
    });
  });

  describe('name', () => {
    it('has correct step name', () => {
      expect(step.name).toBe('voice-assignment');
    });
  });

  describe('execute', () => {
    it('assigns voices to characters based on gender', async () => {
      const context = createContextWithCharacters(testCharacters);
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.voiceMap).toBeDefined();
      expect(result.voiceMap!.size).toBeGreaterThan(0);

      // Alice should get a female voice
      const aliceVoice = result.voiceMap!.get('Alice');
      expect(testPool.female).toContain(aliceVoice);

      // Bob and Charlie should get male voices
      const bobVoice = result.voiceMap!.get('Bob');
      const charlieVoice = result.voiceMap!.get('Charlie');
      expect(testPool.male).toContain(bobVoice);
      expect(testPool.male).toContain(charlieVoice);

      // Charlie's variation should map to same voice
      expect(result.voiceMap!.get('Charles')).toBe(charlieVoice);
    });

    it('preserves existing context properties', async () => {
      const context = createContextWithCharacters(testCharacters, {
        text: 'Original text.',
        fileNames: [['chapter1', 0]],
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.fileNames).toEqual([['chapter1', 0]]);
      expect(result.characters).toEqual(testCharacters);
    });

    it('assigns unique voices to each character', async () => {
      const context = createContextWithCharacters(testCharacters);
      const result = await step.execute(context, createNeverAbortSignal());

      const voices = new Set(result.voiceMap!.values());
      // Should have at least 3 unique voices (one per character)
      // Plus possibly unnamed voices
      expect(voices.size).toBeGreaterThanOrEqual(3);
    });

    it('adds unnamed speaker mappings', async () => {
      const context = createContextWithCharacters(testCharacters);
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.voiceMap!.has('MALE_UNNAMED')).toBe(true);
      expect(result.voiceMap!.has('FEMALE_UNNAMED')).toBe(true);
      expect(result.voiceMap!.has('UNKNOWN_UNNAMED')).toBe(true);
    });
  });

  describe('empty characters', () => {
    it('returns empty voice map when no characters', async () => {
      const context = createContextWithCharacters([]);
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.voiceMap).toBeDefined();
      expect(result.voiceMap!.size).toBe(0);
    });

    it('returns empty voice map when characters undefined', async () => {
      const context = createTestContext();
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.voiceMap).toBeDefined();
      expect(result.voiceMap!.size).toBe(0);
    });
  });

  describe('progress reporting', () => {
    it('reports progress during assignment', async () => {
      const context = createContextWithCharacters(testCharacters);
      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
    });

    it('reports no characters message when empty', async () => {
      const context = createContextWithCharacters([]);
      const { progress } = await collectProgress(step, context);

      expect(progress.some(p => p.message.toLowerCase().includes('no character'))).toBe(true);
    });

    it('reports assigned voice count', async () => {
      const context = createContextWithCharacters(testCharacters);
      const { progress } = await collectProgress(step, context);

      const finalProgress = progress[progress.length - 1];
      expect(finalProgress.message).toContain('3 character');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      await expect(step.execute(createContextWithCharacters(testCharacters), controller.signal))
        .rejects.toThrow();
    });
  });
});
