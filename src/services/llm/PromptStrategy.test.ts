import { describe, it, expect } from 'vitest';
import { ExtractPromptStrategy, AssignPromptStrategy } from './PromptStrategy';

describe('ExtractPromptStrategy.parseResponse', () => {
  const strategy = new ExtractPromptStrategy();
  const dummyContext = { textBlock: 'dummy' };

  it('returns repaired characters when gender is missing', () => {
    const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"]}]}';
    const result = strategy.parseResponse(response, dummyContext);
    expect(result.characters[0].gender).toBe('unknown');
  });

  it('returns repaired characters when variations is null', () => {
    const response = '{"characters":[{"canonicalName":"Jane","variations":null}]}';
    const result = strategy.parseResponse(response, dummyContext);
    expect(result.characters[0].variations).toEqual(['Jane']);
  });

  it('drops characters with empty canonicalName', () => {
    const response = '{"characters":[{"canonicalName":""},{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
    const result = strategy.parseResponse(response, dummyContext);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].canonicalName).toBe('Erick');
  });

  it('passes through already-valid responses unchanged', () => {
    const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
    const result = strategy.parseResponse(response, dummyContext);
    expect(result.characters[0]).toEqual({
      canonicalName: 'Erick',
      variations: ['Erick'],
      gender: 'male',
    });
  });
});

describe('AssignPromptStrategy.parseResponse', () => {
  const strategy = new AssignPromptStrategy();
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

  it('parses valid assign response', () => {
    const response = '0:A\n1:B\n2:A\n3:C';
    const result = strategy.parseResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('Erick');
    expect(result.speakerMap.get(1)).toBe('Jane');
    expect(result.speakerMap.get(2)).toBe('Erick');
    expect(result.speakerMap.get(3)).toBe('System');
  });

  it('filters out incomplete lines like "7"', () => {
    const response = '0:A\n1:B\n2:A\n7';
    const result = strategy.parseResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('Erick');
    expect(result.speakerMap.get(1)).toBe('Jane');
    expect(result.speakerMap.get(2)).toBe('Erick');
    expect(result.speakerMap.get(7)).toBeUndefined(); // Incomplete line filtered
  });

  it('filters out incomplete lines like "15:"', () => {
    const response = '0:A\n1:B\n15:';
    const result = strategy.parseResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('Erick');
    expect(result.speakerMap.get(1)).toBe('Jane');
    expect(result.speakerMap.get(15)).toBeUndefined(); // Incomplete line filtered
  });

  it('handles lines with brackets', () => {
    const response = '[0]:A\n[1]:B\n[2]:C';
    const result = strategy.parseResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('Erick');
    expect(result.speakerMap.get(1)).toBe('Jane');
    expect(result.speakerMap.get(2)).toBe('System');
  });

  it('strips thinking tags', () => {
    const response = '<thinking>\nReasoning here\n</thinking>\n0:A\n1:B';
    const result = strategy.parseResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('Erick');
    expect(result.speakerMap.get(1)).toBe('Jane');
  });
});
