import { describe, expect, it } from 'vitest';
import { MERGE_RULES } from '../merge/rules';

describe('MERGE_RULES', () => {
  it('should instruct model to write reasoning inside JSON field as terse drafts (CoD)', () => {
    expect(MERGE_RULES).toContain(
      'Write your reasoning inside the JSON "reasoning" field as terse drafts',
    );
    expect(MERGE_RULES).toContain('max 5 words per step');
    expect(MERGE_RULES).not.toContain('<thinking_process>');
    expect(MERGE_RULES).not.toContain('</thinking_process>');
    expect(MERGE_RULES).not.toContain('Write your work inside <thinking> tags');
    expect(MERGE_RULES).not.toContain('Step 1:');
    expect(MERGE_RULES).not.toContain('Step 2:');
  });
});
