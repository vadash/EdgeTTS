import { describe, it, expect } from 'vitest';
import { repairExtractCharacters, repairAssignResponse, repairMergeResponse, validateMergeResponse, validateAssignResponse } from './ResponseValidators';
import type { LLMCharacter } from '@/state/types';

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

  it('filters out numeric codes that look like character indices', () => {
    const response = '0:A\n1:72\n2:B\n3:104\n4:C\n5:129';
    const validCodes = new Set(['A', 'B', 'C']);
    const result = repairAssignResponse(response, validCodes);
    expect(result).toBe('0:A\n2:B\n4:C');
  });

  it('filters unknown codes when validCodes provided', () => {
    const response = '0:A\n1:X7\n2:B\n3:Z\n4:C';
    const validCodes = new Set(['A', 'B', 'C']);
    const result = repairAssignResponse(response, validCodes);
    expect(result).toBe('0:A\n2:B\n4:C');
  });

  it('handles real-world log example: block 25 (unknown code X7)', () => {
    // From logs: "Unknown code \"X7\""
    const response = '0:X63\n1:C\n2:X7\n3:A';
    const validCodes = new Set(['A', 'B', 'C']);
    const result = repairAssignResponse(response, validCodes);
    expect(result).toContain('1:C');
    expect(result).toContain('3:A');
    // X63 and X7 should be filtered as unknown
    expect(result).not.toContain('X63');
    expect(result).not.toContain('X7');
  });

  it('handles real-world log example: block 30 (numeric codes)', () => {
    // From logs: "Unknown code \"72\""
    const response = '0:5\n1:5\n2:5\n3:5\n4:5\n5:5\n6:5\n7:5\n8:72\n9:A';
    const validCodes = new Set(['A', 'B', 'C']);
    const result = repairAssignResponse(response, validCodes);
    // Only A should remain (5 and 72 are filtered)
    expect(result).toBe('9:A');
  });
});

describe('repairMergeResponse', () => {
  it('removes duplicate indices within a group', () => {
    const response = '{"merges":[[6,6],[9,9],[10,10],[11,11]]}';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    const parsed = JSON.parse(result.repaired);
    expect(parsed.merges).toHaveLength(0); // All single elements after dedup
    expect(result.warnings.some(w => w.includes('duplicate'))).toBe(true);
  });

  it('handles duplicate indices across groups', () => {
    const response = '{"merges":[[96,107],[106,96]]}';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    const parsed = JSON.parse(result.repaired);
    // First group keeps 96, second group should only have 106
    expect(parsed.merges).toHaveLength(1);
    expect(parsed.merges[0]).toEqual([96, 107]);
    expect(result.warnings.some(w => w.includes('already in previous merge'))).toBe(true);
  });

  it('handles real-world log example: duplicate index 96', () => {
    // From logs: "Merge 18: duplicate index 96"
    const response = '{"merges":[[0,15],[4,124],[7,91],[9,163],[11,92],[14,49],[16,95],[19,88],[21,130],[26,141],[34,40],[41,51],[42,97],[50,98],[54,87],[55,89],[63,101],[96,107],[106,96],[108,135],[113,114],[122,133],[123,134]]}';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    const parsed = JSON.parse(result.repaired);
    // Should remove the duplicate 96 from second group
    expect(parsed.merges).toBeDefined();
    // Check that 96 only appears once
    const allIndices = parsed.merges.flat();
    const count96 = allIndices.filter(i => i === 96).length;
    expect(count96).toBe(1);
  });

  it('handles array instead of object', () => {
    const response = '["<thinking>","Let me analyze"]';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    expect(result.repaired).toBe('{"merges":[]}');
    expect(result.warnings.some(w => w.includes('array instead of object'))).toBe(true);
  });

  it('filters out single-element groups', () => {
    const response = '{"merges":[[0,15],[4],[7,91]]}';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    const parsed = JSON.parse(result.repaired);
    expect(parsed.merges).toHaveLength(2);
    expect(parsed.merges[0]).toEqual([0, 15]);
    expect(parsed.merges[1]).toEqual([7, 91]);
  });

  it('handles indices out of range', () => {
    const response = '{"merges":[[0,15],[4,999]]}';
    const charCount = 168;
    const result = repairMergeResponse(response, charCount);
    const parsed = JSON.parse(result.repaired);
    expect(parsed.merges).toHaveLength(1);
    expect(parsed.merges[0]).toEqual([0, 15]);
    expect(result.warnings.some(w => w.includes('out of range'))).toBe(true);
  });
});

describe('validateMergeResponse with auto-repair', () => {
  it('returns valid with repaired response for duplicate indices', () => {
    const response = '{"merges":[[0,15],[96,107],[106,96]]}';
    const characters = Array.from({ length: 168 }, (_, i) => ({
      canonicalName: `Char${i}`,
      variations: [`Char${i}`],
      gender: 'male' as const,
    }));
    const result = validateMergeResponse(response, characters);
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBeDefined();
  });

  it('returns valid=true for clean response', () => {
    const response = '{"merges":[[0,15],[4,124]]}';
    const characters = Array.from({ length: 168 }, (_, i) => ({
      canonicalName: `Char${i}`,
      variations: [`Char${i}`],
      gender: 'male' as const,
    }));
    const result = validateMergeResponse(response, characters);
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBeUndefined();
  });
});

describe('validateAssignResponse with auto-repair', () => {
  it('filters numeric codes and returns valid with repaired response', () => {
    const response = '0:A\n1:72\n2:B\n3:104\n4:C';
    const codeToName = new Map([['A', 'Alice'], ['B', 'Bob'], ['C', 'Charlie']]);
    const result = validateAssignResponse(response, 100, codeToName);
    expect(result.valid).toBe(true);
    expect(result.repairedResponse).toBeDefined();
    expect(result.repairedResponse).toContain('0:A');
    expect(result.repairedResponse).not.toContain('72');
  });

  it('returns invalid if no valid assignments remain after repair', () => {
    const response = '0:72\n1:104\n2:129';
    const codeToName = new Map([['A', 'Alice'], ['B', 'Bob']]);
    const result = validateAssignResponse(response, 100, codeToName);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('No valid assignments'))).toBe(true);
  });
});
