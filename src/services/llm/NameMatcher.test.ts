import { describe, it, expect } from 'vitest';
import { levenshtein } from './NameMatcher';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length for empty string comparison', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('handles multiple edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is case-insensitive when lowercasing inputs', () => {
    const dist = levenshtein('Hello'.toLowerCase(), 'HELLO'.toLowerCase());
    expect(dist).toBe(0);
  });
});
