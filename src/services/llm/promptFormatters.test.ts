import { describe, expect, it } from 'vitest';
import { buildMessages } from '@/config/prompts/shared/formatters';

describe('buildMessages', () => {
  it('resolves auto to no prefill since compliance presets removed', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'auto');
    // auto resolves to presets that no longer exist
    expect(result).toHaveLength(2);
  });

  it('defaults to none prefill when not specified', () => {
    const result = buildMessages('system body', 'user body');
    // DEFAULT_PREFILL is 'none', which returns empty string, so no assistant message
    expect(result).toHaveLength(2);
  });

  it('duplicates user message when repeatPrompt is true', () => {
    const result = buildMessages('sys', 'user body', 'en', 'none', undefined, true);
    const userMessages = result.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0].content).toBe('user body');
    expect(userMessages[1].content).toBe('user body');
  });

  it('does not duplicate user message by default', () => {
    const result = buildMessages('sys', 'user body');
    const userMessages = result.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
  });
});
