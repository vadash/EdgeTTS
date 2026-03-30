import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { buildAssignPrompt } from './builder';

describe('buildAssignPrompt', () => {
  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
  ];
  const nameToCode = new Map([['Alice', 'A']]);
  const numberedParagraphs = '[0] Some text';

  it('returns 2 messages (system, user) with no prefill', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('includes speaker codes and numbered paragraphs in user message', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs);
    const userContent = result[1].content as string;
    expect(userContent).toContain('<speaker_codes>');
    expect(userContent).toContain('A = Alice');
    expect(userContent).toContain('<numbered_paragraphs>');
    expect(userContent).toContain('[0] Some text');
  });

  it('includes formatted examples in system message', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs);
    const sysContent = result[0].content as string;
    expect(sysContent).toContain('<example_1>');
    expect(sysContent).toContain('<examples>');
  });

  it('includes thinking_process in user constraints', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs);
    const userContent = result[1].content as string;
    expect(userContent).toContain('<thinking_process>');
    expect(userContent).toContain('Step 1: Dialogue scan');
  });

  it('injects overlap sentences with negative indices when provided', () => {
    const overlapSentences = [
      'Fifth to last.',
      'Fourth to last.',
      'Third to last.',
      'Second to last.',
      'Last sentence.',
    ];
    const result = buildAssignPrompt(
      characters,
      nameToCode,
      numberedParagraphs,
      'en',
      overlapSentences,
    );
    const userMessage = result[1].content as string;
    expect(userMessage).toContain('<previous_context_do_not_assign>');
    expect(userMessage).toContain('[-5] Fifth to last.');
    expect(userMessage).toContain('[-1] Last sentence.');
    expect(userMessage).toContain('</previous_context_do_not_assign>');
  });

  it('omits overlap section when not provided', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en');
    const userMessage = result[1].content as string;
    expect(userMessage).not.toContain('<previous_context_do_not_assign>');
  });

  it('accepts detectedLanguage parameter', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'zh');
    // DEFAULT_PREFILL is 'none', so no assistant message is added
    expect(result).toHaveLength(2);
  });
});
