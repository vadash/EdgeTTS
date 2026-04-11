import { describe, expect, it } from 'vitest';
import { ASSIGN_RULES } from '../assign/rules';

describe('ASSIGN_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(ASSIGN_RULES).toContain('Write your reasoning inside the JSON "reasoning" field');
    expect(ASSIGN_RULES).toContain('terse drafts');
    expect(ASSIGN_RULES).toContain('max 5 words per step');
    expect(ASSIGN_RULES).not.toContain('<thinking_process>');
    expect(ASSIGN_RULES).not.toContain('</thinking_process>');
    expect(ASSIGN_RULES).not.toContain('Write your work inside <thinking> tags');
  });
});
