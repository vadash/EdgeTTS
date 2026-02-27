import { describe, expect, it } from 'vitest';
import { parseAssignResponse, parseExtractResponse, parseMergeResponse } from './PromptStrategy';

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
