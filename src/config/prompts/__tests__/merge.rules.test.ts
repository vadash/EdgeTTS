import { describe, expect, it } from 'vitest';
import { MERGE_RULES } from '../merge/rules';

describe('MERGE_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(MERGE_RULES).toContain('Write your step-by-step work inside the JSON "reasoning" field');
    expect(MERGE_RULES).not.toContain('<thinking_process>');
    expect(MERGE_RULES).not.toContain('</thinking_process>');
    expect(MERGE_RULES).not.toContain('Write your work inside <thinking> tags');
  });
});
