import { describe, it, expect } from 'vitest';
import { repairExtractCharacters } from './ResponseValidators';

describe('repairExtractCharacters', () => {
  it('adds gender "unknown" when gender is missing', () => {
    const chars = [{ canonicalName: 'Erick', variations: ['Erick'] }];
    const result = repairExtractCharacters(chars);
    expect(result.characters[0].gender).toBe('unknown');
    expect(result.repaired).toBe(true);
    expect(result.warnings).toContain('Auto-repaired gender for "Erick" → "unknown"');
  });

  it('adds gender "unknown" when gender is null', () => {
    const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: null }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0].gender).toBe('unknown');
    expect(result.repaired).toBe(true);
  });

  it('adds gender "unknown" when gender is invalid string', () => {
    const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: 'Male' }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0].gender).toBe('unknown');
    expect(result.repaired).toBe(true);
  });

  it('preserves valid gender values', () => {
    const chars = [{ canonicalName: 'Erick', variations: ['Erick'], gender: 'male' }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0].gender).toBe('male');
    expect(result.repaired).toBe(false);
  });

  it('sets variations to [canonicalName] when missing', () => {
    const chars = [{ canonicalName: 'Jane', gender: 'female' }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0].variations).toEqual(['Jane']);
    expect(result.repaired).toBe(true);
    expect(result.warnings).toContain('Auto-repaired variations for "Jane"');
  });

  it('sets variations to [canonicalName] when null', () => {
    const chars = [{ canonicalName: 'Rats', variations: null, gender: 'unknown' }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0].variations).toEqual(['Rats']);
    expect(result.repaired).toBe(true);
  });

  it('drops characters with empty canonicalName', () => {
    const chars = [
      { canonicalName: '', variations: [''], gender: 'male' },
      { canonicalName: 'Erick', variations: ['Erick'], gender: 'male' },
    ];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].canonicalName).toBe('Erick');
    expect(result.warnings).toContain('Dropped character with empty/missing canonicalName');
  });

  it('drops characters with null canonicalName', () => {
    const chars = [{ canonicalName: null, variations: null, gender: null }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters).toHaveLength(0);
  });

  it('repairs multiple issues on same character', () => {
    const chars = [{ canonicalName: 'Silverite' }];
    const result = repairExtractCharacters(chars as any);
    expect(result.characters[0]).toEqual({
      canonicalName: 'Silverite',
      variations: ['Silverite'],
      gender: 'unknown',
    });
    expect(result.repaired).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  it('returns repaired=false when nothing needs fixing', () => {
    const chars = [
      { canonicalName: 'Erick', variations: ['Erick', 'Erick Flatt'], gender: 'male' },
      { canonicalName: 'Jane', variations: ['Jane'], gender: 'female' },
    ];
    const result = repairExtractCharacters(chars as any);
    expect(result.repaired).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.characters).toHaveLength(2);
  });
});

import { validateExtractResponse } from './ResponseValidators';

describe('validateExtractResponse with auto-repair', () => {
  it('returns valid=true for response missing gender (auto-repaired)', () => {
    const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"]}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.repairedResponse).toBeDefined();
  });

  it('returns valid=true for response with null variations (auto-repaired)', () => {
    const response = '{"characters":[{"canonicalName":"Rats","variations":null}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBeDefined();
    const parsed = JSON.parse(result.repairedResponse!);
    expect(parsed.characters[0].variations).toEqual(['Rats']);
    expect(parsed.characters[0].gender).toBe('unknown');
  });

  it('returns valid=true with no repairedResponse when input is already valid', () => {
    const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick"],"gender":"male"}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBeUndefined();
  });

  it('returns valid=false when characters array is missing entirely', () => {
    const response = '{"data": "something"}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when all characters have no canonicalName', () => {
    const response = '{"characters":[{"canonicalName":""}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('No valid characters remain');
  });

  it('returns valid=false for completely invalid JSON', () => {
    const response = 'not json at all and really broken';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(false);
  });

  it('repairs real-world log example: block 9 (3 retries in original run)', () => {
    // From logs: gender missing, variations present
    const response = '{"characters":[{"canonicalName":"Erick","variations":["Erick","Erick Flatt"]}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(true);
    const parsed = JSON.parse(result.repairedResponse!);
    expect(parsed.characters[0].gender).toBe('unknown');
  });

  it('repairs real-world log example: block 10 (null variations)', () => {
    const response = '{"characters":[{"canonicalName":"Rats","variations":null}]}';
    const result = validateExtractResponse(response);
    expect(result.valid).toBe(true);
    const parsed = JSON.parse(result.repairedResponse!);
    expect(parsed.characters[0].variations).toEqual(['Rats']);
  });
});
