import { describe, expect, it } from 'vitest';
import type { LLMCharacter } from '@/state/types';
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

  it('filters out invalid character codes', () => {
    const response = {
      reasoning: null,
      assignments: { '0': 'A', '1': 'INVALID', '2': 'C' },
    };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('A');
    expect(result.speakerMap.get(1)).toBeUndefined(); // Invalid code filtered
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
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('assistant');
  });

  it('buildMergePrompt accepts detectedLanguage', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    const result = buildMergePrompt(characters, 'en');
    expect(result).toHaveLength(3);
  });

  it('buildAssignPrompt accepts detectedLanguage', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    const nameToCode = new Map([['Alice', 'A']]);
    const numberedParagraphs = '[0] Some text';
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en');
    expect(result).toHaveLength(3);
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
