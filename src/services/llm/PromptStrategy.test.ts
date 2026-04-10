import { describe, expect, it } from 'vitest';
import type { AssignContext, LLMCharacter } from '@/state/types';
import {
  buildAssignPrompt,
  buildExtractPrompt,
  buildMergePrompt,
  parseAssignResponse,
  parseExtractResponse,
  parseMergeResponse,
} from './PromptStrategy';

describe('parseExtractResponse', () => {
  it('passes through valid responses unchanged', () => {
    const response = {
      reasoning: null,
      characters: [
        {
          canonicalName: 'Erick',
          variations: ['Erick'],
          gender: 'male',
        },
      ],
    };
    const result = parseExtractResponse(response);
    expect(result.characters[0]).toEqual({
      canonicalName: 'Erick',
      variations: ['Erick'],
      gender: 'male',
    });
  });

  it('validates required fields', () => {
    const response = {
      reasoning: null,
      characters: [
        {
          canonicalName: 'Erick',
          variations: ['Erick'],
          gender: 'male',
        },
      ],
    };
    const result = parseExtractResponse(response);
    expect(result.characters).toHaveLength(1);
  });
});

describe('parseMergeResponse', () => {
  it('passes through valid merge responses', () => {
    const response = {
      reasoning: 'Merging similar characters',
      merges: [
        [0, 1],
        [2, 3],
      ],
    };
    const result = parseMergeResponse(response);
    expect(result.merges).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(result.reasoning).toBe('Merging similar characters');
  });

  it('handles null reasoning', () => {
    const response = {
      reasoning: null,
      merges: [[0, 1]],
    };
    const result = parseMergeResponse(response);
    expect(result.merges).toEqual([[0, 1]]);
  });

  it('validates merge groups have 2+ indices', () => {
    const response = {
      reasoning: null,
      merges: [[0]], // Invalid: single element
    };
    expect(() => parseMergeResponse(response)).toThrow();
  });
});

describe('parseAssignResponse', () => {
  const codeToName = new Map([
    ['A', 'Erick'],
    ['B', 'Jane'],
    ['C', 'System'],
  ]);
  const context = {
    characters: [],
    nameToCode: new Map(),
    codeToName,
    numberedParagraphs: '',
    sentenceCount: 10,
  };

  it('parses valid sparse JSON assign response', () => {
    const response = {
      reasoning: null,
      assignments: { '0': 'A', '1': 'B', '2': 'A', '3': 'C' },
    };
    const result = parseAssignResponse(response, context);
    // The speakerMap stores codes (A, B, C), not names
    expect(result.speakerMap.get(0)).toBe('A');
    expect(result.speakerMap.get(1)).toBe('B');
    expect(result.speakerMap.get(2)).toBe('A');
    expect(result.speakerMap.get(3)).toBe('C');
  });

  it('falls back to UNKNOWN_UNNAMED for invalid character codes', () => {
    const response = {
      reasoning: null,
      assignments: { '0': 'A', '1': 'INVALID', '2': 'C' },
    };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('A');
    expect(result.speakerMap.get(1)).toBe('3'); // Invalid code falls back to hardcoded '3'
    expect(result.speakerMap.get(2)).toBe('C');
  });

  it('handles empty assignments', () => {
    const response = {
      reasoning: null,
      assignments: {},
    };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.size).toBe(0);
  });

  it('handles sparse indices', () => {
    const response = {
      reasoning: null,
      assignments: { '0': 'A', '5': 'B', '10': 'C' },
    };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('A');
    expect(result.speakerMap.get(5)).toBe('B');
    expect(result.speakerMap.get(10)).toBe('C');
    expect(result.speakerMap.get(1)).toBeUndefined();
  });
});

describe('Prompt builders accept detectedLanguage', () => {
  it('buildExtractPrompt accepts detectedLanguage', () => {
    const result = buildExtractPrompt('Some text', 'zh');
    // DEFAULT_PREFILL is 'none', so no assistant message
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('buildMergePrompt accepts detectedLanguage', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    const result = buildMergePrompt(characters, 'en');
    // DEFAULT_PREFILL is 'none', so no assistant message
    expect(result).toHaveLength(2);
  });

  it('buildAssignPrompt accepts detectedLanguage', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    const nameToCode = new Map([['Alice', 'A']]);
    const numberedParagraphs = '[0] Some text';
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en');
    // DEFAULT_PREFILL is 'none', so no assistant message
    expect(result).toHaveLength(2);
  });
});

describe('buildAssignPrompt with overlap', () => {
  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
  ];
  const nameToCode = new Map([['Alice', 'A']]);
  const numberedParagraphs = '[0] Some text';

  it('injects overlap sentences with negative indices when provided', () => {
    const overlapSentences = [
      'Fifth to last.',
      'Fourth to last.',
      'Third to last.',
      'Second to last.',
      'Last sentence.',
    ];
    const result = buildAssignPrompt(
      characters,
      nameToCode,
      numberedParagraphs,
      'en',
      overlapSentences,
    );
    const userMessage = result[1].content as string;
    expect(userMessage).toContain('<previous_context_do_not_assign>');
    expect(userMessage).toContain('[-5] Fifth to last.');
    expect(userMessage).toContain('[-4] Fourth to last.');
    expect(userMessage).toContain('[-3] Third to last.');
    expect(userMessage).toContain('[-2] Second to last.');
    expect(userMessage).toContain('[-1] Last sentence.');
    expect(userMessage).toContain('</previous_context_do_not_assign>');
  });

  it('omits overlap section when overlapSentences is empty array', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', []);
    const userMessage = result[1].content as string;
    expect(userMessage).not.toContain('<previous_context_do_not_assign>');
    expect(userMessage).not.toContain('[-1]');
  });

  it('omits overlap section when overlapSentences is not provided (undefined)', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en');
    const userMessage = result[1].content as string;
    expect(userMessage).not.toContain('<previous_context_do_not_assign>');
    expect(userMessage).not.toContain('[-1]');
  });

  it('handles fewer than 5 overlap sentences', () => {
    const overlapSentences = ['Second to last.', 'Last sentence.'];
    const result = buildAssignPrompt(
      characters,
      nameToCode,
      numberedParagraphs,
      'en',
      overlapSentences,
    );
    const userMessage = result[1].content as string;
    expect(userMessage).toContain('<previous_context_do_not_assign>');
    expect(userMessage).toContain('[-2] Second to last.');
    expect(userMessage).toContain('[-1] Last sentence.');
    expect(userMessage).not.toContain('[-3]');
  });

  it('includes recency-bias note after numbered paragraphs', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', [
      'Some overlap.',
    ]);
    const userMessage = result[1].content as string;
    const paragraphsPos = userMessage.indexOf('<numbered_paragraphs>');
    const notePos = userMessage.indexOf('[0] and above');
    expect(notePos).toBeGreaterThan(paragraphsPos);
  });
});

describe('fallback: unmapped codes', () => {
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
