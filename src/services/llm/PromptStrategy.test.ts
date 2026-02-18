import { describe, it, expect } from 'vitest';
import { ExtractPromptStrategy } from './PromptStrategy';

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
