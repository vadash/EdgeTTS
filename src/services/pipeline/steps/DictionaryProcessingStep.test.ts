import { describe, it, expect } from 'vitest';
import { createDictionaryProcessingStep } from './DictionaryProcessingStep';
import { createContextWithAssignments, createNeverAbortSignal } from '@/test/pipeline/helpers';
import type { SpeakerAssignment } from '@/state/types';

describe('DictionaryProcessingStep', () => {
  const signal = createNeverAbortSignal();

  const createAssignment = (text: string): SpeakerAssignment => ({
    sentenceIndex: 0,
    text,
    speaker: 'narrator',
    voice: 'test-voice',
  });

  describe('word boundary rules', () => {
    it('applies word boundary replacement', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Dr. Smith arrived at the lab.')],
        { dictionaryRules: ['Dr.=Doctor'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Doctor Smith arrived at the lab.');
    });

    it('respects word boundaries', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('The cat sat on the catalog.')],
        { dictionaryRules: ['cat=feline'] }
      );

      const result = await step.execute(context, signal);

      // Should only replace standalone "cat", not "cat" in "catalog"
      expect(result.assignments![0].text).toBe('The feline sat on the catalog.');
    });
  });

  describe('exact match rules', () => {
    it('applies exact string replacement', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Check the temp reading.')],
        { dictionaryRules: ['"temp"="temperature"'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Check the temperature reading.');
    });

    it('replaces all occurrences in exact mode', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('temp and more temp here.')],
        { dictionaryRules: ['"temp"="temperature"'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('temperature and more temperature here.');
    });

    it('case insensitive matching when caseSensitive is false', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('TEMP and Temp and temp.')],
        { dictionaryRules: ['"temp"="temperature"'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('temperature and temperature and temperature.');
    });

    it('case sensitive matching when caseSensitive is true', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: true });
      const context = createContextWithAssignments(
        [createAssignment('TEMP and Temp and temp.')],
        { dictionaryRules: ['"temp"="temperature"'] }
      );

      const result = await step.execute(context, signal);

      // Only exact case match should be replaced
      expect(result.assignments![0].text).toBe('TEMP and Temp and temperature.');
    });
  });

  describe('regex rules', () => {
    it('applies regex pattern replacement', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Visit the lab today.')],
        { dictionaryRules: ['regex"\\blab\\b"="laboratory"'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Visit the laboratory today.');
    });

    it('handles newline replacements in regex', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Line one.Line two.')],
        { dictionaryRules: ['regex"\\."="\\n"'] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Line one\nLine two\n');
    });

    it('handles invalid regex gracefully', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Test text.')],
        { dictionaryRules: ['regex"[invalid"="replacement"'] }
      );

      // Should not throw, just skip the invalid rule
      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Test text.');
    });
  });

  describe('multiple rules', () => {
    it('applies multiple rules in sequence', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Dr. Smith went to the lab.')],
        {
          dictionaryRules: [
            'Dr.=Doctor',
            'regex"\\blab\\b"="laboratory"',
          ],
        }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Doctor Smith went to the laboratory.');
    });
  });

  describe('edge cases', () => {
    it('passes through when no rules', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Original text.')],
        { dictionaryRules: [] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Original text.');
    });

    it('passes through when dictionaryRules is undefined', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments([createAssignment('Original text.')]);
      delete (context as Record<string, unknown>).dictionaryRules;

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Original text.');
    });

    it('skips empty rules', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments(
        [createAssignment('Test text.')],
        { dictionaryRules: ['', 'Dr.=Doctor', ''] }
      );

      const result = await step.execute(context, signal);

      expect(result.assignments![0].text).toBe('Test text.');
    });

    it('throws when no assignments provided', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = createContextWithAssignments([]);

      await expect(step.execute(context, signal)).rejects.toThrow(
        "non-empty 'assignments'"
      );
    });

    it('throws when assignments is undefined', async () => {
      const step = createDictionaryProcessingStep({ caseSensitive: false });
      const context = { text: 'test', fileNames: [], dictionaryRules: [], detectedLanguage: 'en' as const };

      await expect(step.execute(context, signal)).rejects.toThrow(
        "requires 'assignments'"
      );
    });
  });
});
