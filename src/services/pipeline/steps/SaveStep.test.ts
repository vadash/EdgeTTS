import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveStep, createSaveStep } from './SaveStep';
import { createTestContext, createNeverAbortSignal, createTestAbortController, collectProgress, createMockDirectoryHandle } from '@/test/pipeline/helpers';

describe('SaveStep', () => {
  let step: SaveStep;

  beforeEach(() => {
    step = createSaveStep({
      narratorVoice: 'en-US-GuyNeural',
    });
  });

  describe('name', () => {
    it('has correct step name', () => {
      expect(step.name).toBe('save');
    });
  });

  describe('execute', () => {
    it('preserves existing context properties', async () => {
      const context = createTestContext({
        text: 'Original text.',
        audioMap: new Map([[0, 'chunk_000000.bin']]),
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.audioMap?.size).toBe(1);
    });

    it('returns context unchanged', async () => {
      const context = createTestContext({});

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result).toEqual(context);
    });
  });

  describe('voice mapping JSON', () => {
    it('saves voice mapping when character data is present', async () => {
      const mockHandle = createMockDirectoryHandle();
      const context = createTestContext({
        directoryHandle: mockHandle,
        fileNames: [['TestBook', 0]],
        characters: [{ canonicalName: 'Alice', gender: 'female', variations: [] }],
        voiceMap: new Map([['Alice', 'en-US-JennyNeural']]),
        assignments: [{ sentenceIndex: 0, text: 'Hello', speaker: 'Alice', voiceId: 'en-US-JennyNeural' }],
      });

      const { progress } = await collectProgress(step, context);

      expect(progress.some(p => p.message.toLowerCase().includes('voice mapping'))).toBe(true);
    });

    it('does not save voice mapping when no characters', async () => {
      const mockHandle = createMockDirectoryHandle();
      const context = createTestContext({
        directoryHandle: mockHandle,
      });

      const { progress } = await collectProgress(step, context);

      // Should just show completion, no voice mapping message
      expect(progress.some(p => p.message.toLowerCase().includes('voice mapping'))).toBe(false);
    });
  });

  describe('progress reporting', () => {
    it('reports progress', async () => {
      const context = createTestContext({});

      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
    });

    it('reports complete', async () => {
      const context = createTestContext({});

      const { progress } = await collectProgress(step, context);

      const finalProgress = progress[progress.length - 1];
      expect(finalProgress.message.toLowerCase()).toContain('complete');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      const context = createTestContext({});

      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });
  });

  describe('dropsContextKeys', () => {
    it('does not drop any context keys (TTS data must persist)', () => {
      expect(step.dropsContextKeys).toEqual([]);
    });
  });
});
