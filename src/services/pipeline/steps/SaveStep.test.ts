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
    it('reports saved file count from context', async () => {
      const context = createTestContext({
        savedFileCount: 5,
      });

      const { progress } = await collectProgress(step, context);

      expect(progress[0].message).toContain('5');
      expect(progress[0].message).toContain('audio file');
    });

    it('preserves existing context properties', async () => {
      const context = createTestContext({
        text: 'Original text.',
        savedFileCount: 3,
        audioMap: new Map([[0, 'chunk_000000.bin']]),
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.savedFileCount).toBe(3);
      expect(result.audioMap?.size).toBe(1);
    });

    it('returns context unchanged', async () => {
      const context = createTestContext({
        savedFileCount: 2,
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result).toEqual(context);
    });
  });

  describe('voice mapping JSON', () => {
    it('saves voice mapping when character data is present', async () => {
      const mockHandle = createMockDirectoryHandle();
      const context = createTestContext({
        savedFileCount: 1,
        directoryHandle: mockHandle,
        fileNames: [['TestBook', 0]],
        characters: [{ code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] }],
        voiceMap: new Map([['A', 'en-US-JennyNeural']]),
        assignments: [{ sentenceIndex: 0, text: 'Hello', speaker: 'A', voiceId: 'en-US-JennyNeural' }],
      });

      const { progress } = await collectProgress(step, context);

      expect(progress.some(p => p.message.toLowerCase().includes('voice mapping'))).toBe(true);
    });

    it('does not save voice mapping when no characters', async () => {
      const mockHandle = createMockDirectoryHandle();
      const context = createTestContext({
        savedFileCount: 1,
        directoryHandle: mockHandle,
      });

      const { progress } = await collectProgress(step, context);

      // Should just show completion, no voice mapping message
      expect(progress.some(p => p.message.toLowerCase().includes('voice mapping'))).toBe(false);
    });
  });

  describe('progress reporting', () => {
    it('reports progress', async () => {
      const context = createTestContext({
        savedFileCount: 2,
      });

      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
    });

    it('reports complete', async () => {
      const context = createTestContext({
        savedFileCount: 2,
      });

      const { progress } = await collectProgress(step, context);

      const finalProgress = progress[progress.length - 1];
      expect(finalProgress.message.toLowerCase()).toContain('complete');
    });

    it('handles zero files gracefully', async () => {
      const context = createTestContext({
        savedFileCount: 0,
      });

      const { progress } = await collectProgress(step, context);

      expect(progress[0].message).toContain('0');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      const context = createTestContext({
        savedFileCount: 2,
      });

      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });
  });

  describe('dropsContextKeys', () => {
    it('declares assignments, characters, and voiceMap as droppable', () => {
      expect(step.dropsContextKeys).toContain('assignments');
      expect(step.dropsContextKeys).toContain('characters');
      expect(step.dropsContextKeys).toContain('voiceMap');
      expect(step.dropsContextKeys).not.toContain('directoryHandle');
    });
  });
});
