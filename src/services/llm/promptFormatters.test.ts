import { describe, expect, it } from 'vitest';
import { buildMessages } from './promptFormatters';

describe('buildMessages', () => {
  it('resolves auto to cn_compliance for Chinese', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'auto');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('系统日志');
  });

  it('resolves auto to en_compliance for non-Chinese', () => {
    const result = buildMessages('system body', 'user body', 'en', 'auto');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('System Status');
  });

  it('resolves auto to en_compliance for unknown language', () => {
    const result = buildMessages('system body', 'user body', 'fr', 'auto');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    expect(result[2].content).toContain('System Status');
  });

  it('uses explicit prefill when provided', () => {
    const result = buildMessages('system body', 'user body', 'zh', 'pure_think');
    expect(result).toHaveLength(3);
    expect(result[2].content).toBe('<think>\n');
  });

  it('defaults to auto prefill when not specified', () => {
    const result = buildMessages('system body', 'user body');
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('assistant');
    // Default detectedLanguage is 'en', so should use en_compliance
    expect(result[2].content).toContain('System Status');
  });
});
