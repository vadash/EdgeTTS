import { describe, it, expect } from 'vitest';
import { repairExtractCharacters, repairAssignResponse } from './ResponseValidators';

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

describe('repairAssignResponse', () => {
  it('filters out incomplete lines like "7"', () => {
    const response = '0:A\n1:A\n2:A\n3:A\n4:H\n5:B\n6:A\n7';
    const result = repairAssignResponse(response);
    expect(result).toBe('0:A\n1:A\n2:A\n3:A\n4:H\n5:B\n6:A');
  });

  it('filters out incomplete lines like "15"', () => {
    const response = '0:A\n1:A\n2:A\n3:A\n4:H\n5:B\n6:A\n7:b\n8:E\n9:A\n10:E\n11:A\n12:B\n13:A\n14:H\n15';
    const result = repairAssignResponse(response);
    expect(result).toContain('0:A');
    expect(result).toContain('14:H');
    expect(result).not.toContain('15');
  });

  it('filters out incomplete lines like "7:"', () => {
    const response = '0:A\n1:A\n2:A\n3:A\n4:A\n5:F\n6:';
    const result = repairAssignResponse(response);
    expect(result).toBe('0:A\n1:A\n2:A\n3:A\n4:A\n5:F');
  });

  it('keeps valid lines with brackets', () => {
    const response = '[0]:A\n[1]:B\n2:C';
    const result = repairAssignResponse(response);
    expect(result).toBe('[0]:A\n[1]:B\n2:C');
  });

  it('handles empty response', () => {
    const result = repairAssignResponse('');
    expect(result).toBe('');
  });

  it('handles thinking tags', () => {
    const response = '<thinking>\nLet me think...\n</thinking>\n0:A\n1:B\n2:C';
    const result = repairAssignResponse(response);
    expect(result).toBe('0:A\n1:B\n2:C');
  });
});
