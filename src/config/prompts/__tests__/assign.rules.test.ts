import { describe, it, expect } from 'vitest';
import { ASSIGN_RULES } from '../assign/rules';

describe('ASSIGN_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(ASSIGN_RULES).toContain('Write your step-by-step work inside the JSON "reasoning" field');
    expect(ASSIGN_RULES).not.toContain('<thinking_process>');
    expect(ASSIGN_RULES).not.toContain('</thinking_process>');
    expect(ASSIGN_RULES).not.toContain('Write your work inside <thinking> tags');
  });
});
