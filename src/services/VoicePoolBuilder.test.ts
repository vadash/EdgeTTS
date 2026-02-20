import { describe, it, expect } from 'vitest';
import {
  VoicePoolBuilder,
  buildVoicePool,
  getRandomVoice,
} from './VoicePoolBuilder';

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
