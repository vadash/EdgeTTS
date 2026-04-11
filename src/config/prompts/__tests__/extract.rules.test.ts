import { describe, expect, it } from 'vitest';
import { EXTRACT_RULES } from '../extract/rules';

describe('EXTRACT_RULES', () => {
  it('should instruct model to write reasoning inside JSON field using Chain of Draft', () => {
    expect(EXTRACT_RULES).toContain(
      'Write your reasoning inside the JSON "reasoning" field as terse drafts',
    );
    expect(EXTRACT_RULES).toContain('max 5 words per step');
    expect(EXTRACT_RULES).not.toContain('<thinking_process>');
    expect(EXTRACT_RULES).not.toContain('</thinking_process>');
    expect(EXTRACT_RULES).not.toContain('Write your work inside <thinking> tags');
  });

  it('should include aggressive character extraction rule', () => {
    expect(EXTRACT_RULES).toContain('Extract EVERY named character who speaks');
    expect(EXTRACT_RULES).toContain('mentors, shopkeepers, or background characters');
  });
});
