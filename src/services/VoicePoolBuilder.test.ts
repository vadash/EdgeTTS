import { describe, it, expect } from 'vitest';
import {
  VoicePoolBuilder,
  buildVoicePool,
  getRandomVoice,
  deduplicateVariants,
} from './VoicePoolBuilder';
import type { VoiceOption } from '../state/types';

describe('VoicePoolBuilder', () => {
  describe('VoicePoolBuilder class', () => {
    it('builds pool for locale with multilingual voices', () => {
      const builder = new VoicePoolBuilder();
      const pool = builder.buildPool('en');

      expect(pool.male.length).toBeGreaterThan(0);
      expect(pool.female.length).toBeGreaterThan(0);
      // Should include English voices or multilingual voices
      const hasEnglishOrMultilingual = pool.male.some(
        v => v.startsWith('en') || v.includes('Multilingual')
      );
      expect(hasEnglishOrMultilingual).toBe(true);
    });

    it('respects enabledVoices allowlist', () => {
      const builder = new VoicePoolBuilder();
      const pool = builder.buildPool('en', ['en-US, GuyNeural']);

      expect([...pool.male, ...pool.female]).toEqual(['en-US, GuyNeural']);
    });
  });

  describe('buildVoicePool', () => {
    it('filters by locale prefix', () => {
      const pool = buildVoicePool({ language: 'en' });

      expect(pool.male.length).toBeGreaterThan(0);
      expect(pool.female.length).toBeGreaterThan(0);
      pool.male.forEach(v => expect(v.startsWith('en')).toBe(true));
      pool.female.forEach(v => expect(v.startsWith('en')).toBe(true));
    });

    it('separates male and female voices', () => {
      const pool = buildVoicePool({ language: 'en' });

      const uniqueMale = new Set(pool.male);
      expect(uniqueMale.size).toBe(pool.male.length);

      const uniqueFemale = new Set(pool.female);
      expect(uniqueFemale.size).toBe(pool.female.length);

      const maleSet = new Set(pool.male);
      pool.female.forEach(v => expect(maleSet.has(v)).toBe(false));
    });

    it('returns all voices when no options specified', () => {
      const pool = buildVoicePool();
      const totalVoices = pool.male.length + pool.female.length;

      expect(totalVoices).toBeGreaterThan(0);
    });

    it('returns empty pools for non-existent locale', () => {
      const pool = buildVoicePool({ language: 'xx' });

      expect(pool.male).toHaveLength(0);
      expect(pool.female).toHaveLength(0);
    });

    it('includes multilingual voices when flag set', () => {
      const pool = buildVoicePool({ language: 'ru', includeMultilingual: true });

      const hasRussian = [...pool.male, ...pool.female].some(v => v.startsWith('ru'));
      expect(hasRussian).toBe(true);

      const hasMultilingual = [...pool.male, ...pool.female].some(v =>
        v.includes('Multilingual')
      );
      expect(hasMultilingual).toBe(true);
    });

    it('does not include multilingual voices when flag not set', () => {
      const poolWithout = buildVoicePool({ language: 'ru', includeMultilingual: false });
      const poolWith = buildVoicePool({ language: 'ru', includeMultilingual: true });

      expect(poolWith.male.length + poolWith.female.length)
        .toBeGreaterThan(poolWithout.male.length + poolWithout.female.length);
    });

    it('respects enabledVoices allowlist', () => {
      const pool = buildVoicePool({
        language: 'en',
        enabledVoices: ['en-US, GuyNeural', 'en-US, JennyNeural'],
      });

      expect([...pool.male, ...pool.female].sort()).toEqual(['en-US, GuyNeural', 'en-US, JennyNeural']);
    });

    it('contains non-Multilingual variants for voices that have Multilingual pairs', () => {
      const pool = buildVoicePool({ language: 'en' });
      const all = [...pool.male, ...pool.female];

      // These are the non-Multilingual counterparts that must exist
      expect(all).toContain('en-US, AndrewNeural');
      expect(all).toContain('en-US, AvaNeural');
      expect(all).toContain('en-US, BrianNeural');
      expect(all).toContain('en-US, EmmaNeural');
    });

    it('deduplicates Multilingual pairs for EN book — keeps non-Multilingual', () => {
      const pool = buildVoicePool({ language: 'en', includeMultilingual: true });
      const all = [...pool.male, ...pool.female];

      // AndrewNeural should be present, not AndrewMultilingualNeural
      expect(all).toContain('en-US, AndrewNeural');
      expect(all).not.toContain('en-US, AndrewMultilingualNeural');
    });

    it('deduplicates Multilingual pairs for RU book — Multilingual voices included without native pair conflict', () => {
      const pool = buildVoicePool({ language: 'ru', includeMultilingual: true });
      const all = [...pool.male, ...pool.female];

      // Russian native voices present
      expect(all).toContain('ru-RU, DmitryNeural');
      expect(all).toContain('ru-RU, SvetlanaNeural');
      // Multilingual voices present (no non-Multilingual EN voice leaks in)
      expect(all).toContain('en-US, AndrewMultilingualNeural');
      expect(all).not.toContain('en-US, AndrewNeural');
    });

    it('orders native voices before Multilingual in pool', () => {
      const pool = buildVoicePool({ language: 'ru', includeMultilingual: true });

      // All ru-* voices should appear before any Multilingual voice
      const firstMultiIdx = pool.male.findIndex(v => v.includes('Multilingual'));
      const lastNativeIdx = pool.male.reduce(
        (last, v, i) => v.startsWith('ru') ? i : last, -1
      );

      if (firstMultiIdx !== -1 && lastNativeIdx !== -1) {
        expect(lastNativeIdx).toBeLessThan(firstMultiIdx);
      }
    });
  });

  describe('getRandomVoice', () => {
    it('returns male voice for male gender', () => {
      const voice = getRandomVoice('male', { language: 'en' });
      const pool = buildVoicePool({ language: 'en' });

      expect(pool.male).toContain(voice);
    });

    it('returns female voice for female gender', () => {
      const voice = getRandomVoice('female', { language: 'en' });
      const pool = buildVoicePool({ language: 'en' });

      expect(pool.female).toContain(voice);
    });

    it('returns any voice for unknown gender', () => {
      const voice = getRandomVoice('unknown', { language: 'en' });
      const pool = buildVoicePool({ language: 'en' });
      const allVoices = [...pool.male, ...pool.female];

      expect(allVoices).toContain(voice);
    });

    it('respects exclusion set', () => {
      const pool = buildVoicePool({ language: 'en' });
      const excluded = new Set(pool.male.slice(0, pool.male.length - 1));

      const voice = getRandomVoice('male', { language: 'en' }, excluded);

      expect(excluded.has(voice)).toBe(false);
    });

    it('falls back to full pool when all voices excluded', () => {
      const pool = buildVoicePool({ language: 'en' });
      const excluded = new Set(pool.male);

      const voice = getRandomVoice('male', { language: 'en' }, excluded);
      expect(pool.male).toContain(voice);
    });
  });
});

describe('deduplicateVariants', () => {
  // Helper to create VoiceOption objects for testing
  const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  it('keeps non-Multilingual variant for native-language book', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AriaNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    const names = result.map(v => v.fullValue);
    expect(names).toContain('en-US, AndrewNeural');
    expect(names).not.toContain('en-US, AndrewMultilingualNeural');
    expect(names).toContain('en-US, AriaNeural');
  });

  it('keeps Multilingual variant for foreign-language book', () => {
    const candidates = [
      vo('ru-RU, DmitryNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
    ];
    const result = deduplicateVariants(candidates, 'ru');

    const names = result.map(v => v.fullValue);
    expect(names).toContain('ru-RU, DmitryNeural');
    expect(names).toContain('en-US, AndrewMultilingualNeural');
  });

  it('passes through voices with no Multilingual pair unchanged', () => {
    const candidates = [
      vo('en-US, GuyNeural', 'male'),
      vo('en-US, JennyNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    expect(result).toHaveLength(2);
  });

  it('orders non-Multilingual voices before Multilingual', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
      vo('ru-RU, DmitryNeural', 'male'),
    ];
    const result = deduplicateVariants(candidates, 'ru');

    // DmitryNeural (native, non-multi) should come before AndrewMultilingualNeural
    const dmitryIdx = result.findIndex(v => v.name === 'DmitryNeural');
    const andrewIdx = result.findIndex(v => v.name === 'AndrewMultilingualNeural');
    expect(dmitryIdx).toBeLessThan(andrewIdx);
  });

  it('handles empty input', () => {
    expect(deduplicateVariants([], 'en')).toEqual([]);
  });

  it('deduplicates multiple pairs at once', () => {
    const candidates = [
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, BrianMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, AvaMultilingualNeural', 'female'),
      vo('en-US, AvaNeural', 'female'),
      vo('en-US, AriaNeural', 'female'),
    ];
    const result = deduplicateVariants(candidates, 'en');

    const names = result.map(v => v.fullValue);
    // Non-Multilingual variants kept for EN book
    expect(names).toContain('en-US, AndrewNeural');
    expect(names).toContain('en-US, BrianNeural');
    expect(names).toContain('en-US, AvaNeural');
    expect(names).toContain('en-US, AriaNeural');
    // Multilingual variants removed
    expect(names).not.toContain('en-US, AndrewMultilingualNeural');
    expect(names).not.toContain('en-US, BrianMultilingualNeural');
    expect(names).not.toContain('en-US, AvaMultilingualNeural');
    expect(result).toHaveLength(4);
  });
});
