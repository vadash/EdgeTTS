import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
import { buildMergePrompt } from './builder';

describe('buildMergePrompt', () => {
  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
  ];

  it('returns 2 messages (system, user) with no prefill', () => {
    const result = buildMergePrompt(characters);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('injects character list into user message', () => {
    const result = buildMergePrompt(characters);
    const userContent = result[1].content as string;
    expect(userContent).toContain('Alice');
    expect(userContent).toContain('<character_list>');
  });

  it('includes formatted examples in system message', () => {
    const result = buildMergePrompt(characters);
    const sysContent = result[0].content as string;
    expect(sysContent).toContain('<example_1>');
    expect(sysContent).toContain('<examples>');
  });

  it('includes thinking_process in user constraints', () => {
    const result = buildMergePrompt(characters);
    const userContent = result[1].content as string;
    expect(userContent).toContain('<thinking_process>');
    expect(userContent).toContain('Step 1: Variation cross-check');
  });

  it('accepts detectedLanguage parameter', () => {
    const result = buildMergePrompt(characters, 'zh');
    // DEFAULT_PREFILL is 'none', so no assistant message is added
    expect(result).toHaveLength(2);
  });
});
