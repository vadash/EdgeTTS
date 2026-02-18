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
