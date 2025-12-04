import { describe, it, expect } from 'vitest';
import { createTextSanitizationStep } from './TextSanitizationStep';
import { createContextWithAssignments, createNeverAbortSignal } from '@/test/pipeline/helpers';
import type { SpeakerAssignment } from '@/state/types';

describe('TextSanitizationStep', () => {
  const signal = createNeverAbortSignal();

  const createAssignment = (text: string): SpeakerAssignment => ({
    sentenceIndex: 0,
    text,
    speaker: 'narrator',
    voice: 'test-voice',
  });

  describe('execute', () => {
    it('removes markdown headers', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('# Header Text'),
        createAssignment('## Subheader'),
        createAssignment('###### Deep header'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Header Text');
      expect(result.assignments![1].text).toBe('Subheader');
      expect(result.assignments![2].text).toBe('Deep header');
    });

    it('removes bold markdown', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('This is **bold** text'),
        createAssignment('This is __also bold__ text'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('This is bold text');
      expect(result.assignments![1].text).toBe('This is also bold text');
    });

    it('removes italic markdown', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('This is *italic* text'),
        createAssignment('This is _also italic_ text'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('This is italic text');
      expect(result.assignments![1].text).toBe('This is also italic text');
    });

    it('removes bold italic markdown', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('This is ***bold italic*** text'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('This is bold italic text');
    });

    it('removes strikethrough markdown', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('This is ~~strikethrough~~ text'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('This is strikethrough text');
    });

    it('removes inline code', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Use the `console.log` function'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Use the console.log function');
    });

    it('removes HTML tags', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('<p>Paragraph text</p>'),
        createAssignment('<div class="test">Content</div>'),
        createAssignment('Text with <br/> break'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Paragraph text');
      expect(result.assignments![1].text).toBe('Content');
      expect(result.assignments![2].text).toBe('Text with break');
    });

    it('removes zero-width characters', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Text\u200Bwith\u200Czero\u200Dwidth'),
        createAssignment('\uFEFFBOM at start'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Textwithzerowidth');
      expect(result.assignments![1].text).toBe('BOM at start');
    });

    it('removes control characters', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Text\x00with\x07control\x1Fchars'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Textwithcontrolchars');
    });

    it('converts ampersand to "and"', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Rock & Roll'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Rock and Roll');
    });

    it('converts backslash to forward slash', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('path\\to\\file'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('path/to/file');
    });

    it('removes special characters that TTS cannot pronounce', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Text with ~ tilde'),
        createAssignment('Text with | pipe'),
        createAssignment('Text with ^ caret'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Text with tilde');
      expect(result.assignments![1].text).toBe('Text with pipe');
      expect(result.assignments![2].text).toBe('Text with caret');
    });

    it('normalizes multiple spaces to single space', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('Text    with   multiple    spaces'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Text with multiple spaces');
    });

    it('converts horizontal rules to pause marker', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([
        createAssignment('---'),
        createAssignment('***'),
        createAssignment('___'),
      ]);

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('...');
      expect(result.assignments![1].text).toBe('...');
      expect(result.assignments![2].text).toBe('...');
    });

    it('throws when no assignments provided', async () => {
      const step = createTextSanitizationStep();
      const context = createContextWithAssignments([]);

      await expect(step.execute(context, signal)).rejects.toThrow(
        "non-empty 'assignments'"
      );
    });

    it('throws when assignments is undefined', async () => {
      const step = createTextSanitizationStep();
      const context = { text: 'test', fileNames: [], dictionaryRules: [], detectedLanguage: 'en' as const };

      await expect(step.execute(context, signal)).rejects.toThrow(
        "requires 'assignments'"
      );
    });
  });
});
