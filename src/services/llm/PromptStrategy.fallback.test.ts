import { describe, expect, it } from 'vitest';
import type { AssignContext } from './PromptStrategy';
import { parseAssignResponse } from './PromptStrategy';

describe('parseAssignResponse - unknown code fallback', () => {
  const createContext = (codes: Record<string, string>): AssignContext => ({
    characters: [],
    nameToCode: new Map(Object.entries(codes)),
    codeToName: new Map(Object.entries(codes).map(([k, v]) => [v, k])),
    numberedParagraphs: '',
    sentenceCount: 0,
  });

  it('should map valid codes normally', () => {
    const context = createContext({ John: '1', Mary: '2', UNKNOWN_UNNAMED: '3' });
    const response = { assignments: { '0': '1', '1': '2' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('1');
    expect(result.speakerMap.get(1)).toBe('2');
  });

  it('should fallback to UNKNOWN_UNNAMED when code is not recognized', () => {
    const context = createContext({ John: '1', UNKNOWN_UNNAMED: '3' });
    const response = { assignments: { '0': '1', '1': '999' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('1');
    expect(result.speakerMap.get(1)).toBe('3'); // Falls back to UNKNOWN_UNNAMED
  });

  it('should fallback to code "3" when UNKNOWN_UNNAMED not in maps', () => {
    const context = createContext({ John: '1' }); // No UNKNOWN_UNNAMED defined
    const response = { assignments: { '0': '999' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('3'); // Hardcoded fallback
  });
});
