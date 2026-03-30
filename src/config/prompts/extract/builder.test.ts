import { describe, expect, it } from 'vitest';
import { buildExtractPrompt } from './builder';

describe('buildExtractPrompt', () => {
  it('returns 2 messages (system, user) with no prefill', () => {
    const result = buildExtractPrompt('Hello world');
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('injects text into user message', () => {
    const result = buildExtractPrompt('Hello world');
    const userContent = result[1].content as string;
    expect(userContent).toContain('Hello world');
  });

  it('includes role in system message', () => {
    const result = buildExtractPrompt('text');
    const sysContent = result[0].content as string;
    expect(sysContent).toContain('text extraction bot');
  });

  it('includes formatted examples in system message', () => {
    const result = buildExtractPrompt('text');
    const sysContent = result[0].content as string;
    expect(sysContent).toContain('<example_1>');
    expect(sysContent).toContain('<examples>');
  });

  it('includes thinking_process in user constraints', () => {
    const result = buildExtractPrompt('text');
    const userContent = result[1].content as string;
    expect(userContent).toContain('<thinking_process>');
    expect(userContent).toContain('Step 1: Speaker scan');
  });

  it('includes constraints in user message', () => {
    const result = buildExtractPrompt('text');
    const userContent = result[1].content as string;
    expect(userContent).toContain('<task_rules>');
    expect(userContent).toContain('<output_schema>');
    expect(userContent).toContain('OUTPUT FORMAT:');
  });

  it('accepts detectedLanguage parameter', () => {
    const result = buildExtractPrompt('text', 'zh');
    // DEFAULT_PREFILL is 'none', so no assistant message is added
    expect(result).toHaveLength(2);
  });
});
