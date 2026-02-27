import { describe, expect, it } from 'vitest';
import type { VoicePool, VoiceOption } from '@/state/types';
import { VoicePoolTracker, buildPriorityPool } from './VoiceAllocator';

describe('VoicePoolTracker', () => {
  const pool: VoicePool = {
    male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, AndrewMultilingualNeural'],
    female: ['en-US, AvaNeural', 'en-US, JennyNeural'],
  };

  describe('pickVoice', () => {
    it('picks voices sequentially from pool (first available, not random)', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      // Should always pick first available = AndrewNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, AndrewNeural');

      // Second pick should be BrianNeural (AndrewNeural now used)
      const second = tracker.pickVoice('male');
      expect(second).toBe('en-US, BrianNeural');

      // Third pick should be AndrewMultilingualNeural
      const third = tracker.pickVoice('male');
      expect(third).toBe('en-US, AndrewMultilingualNeural');
    });

    it('respects reserved voices when picking sequentially', () => {
      const reserved = new Set(['en-US, AndrewNeural']);
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural', reserved);

      // AndrewNeural is reserved, should skip to BrianNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, BrianNeural');
    });

    it('cycles through pool when exhausted', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      // Exhaust female pool
      tracker.pickVoice('female'); // AvaNeural
      tracker.pickVoice('female'); // JennyNeural

      // Pool exhausted — should cycle from beginning
      const reused = tracker.pickVoice('female');
      expect(pool.female).toContain(reused);
    });

    it('narrator voice is always reserved', () => {
      const smallPool: VoicePool = {
        male: ['en-US, NarratorNeural', 'en-US, BrianNeural'],
        female: [],
      };
      const tracker = new VoicePoolTracker(smallPool, 'en-US, NarratorNeural');

      // Should skip narrator, pick BrianNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, BrianNeural');
    });
  });
});

describe('buildPriorityPool', () => {
  const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  it('deduplicates Multilingual pairs for EN book — keeps non-Multilingual', () => {
    const voices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, BrianMultilingualNeural', 'male'),
      vo('en-US, AriaNeural', 'female'),
    ];
    const result = buildPriorityPool(voices, 'en', new Set());

    const maleNames = result.male.map((v) => v.fullValue);
    expect(maleNames).toContain('en-US, AndrewNeural');
    expect(maleNames).not.toContain('en-US, AndrewMultilingualNeural');
    expect(maleNames).toContain('en-US, BrianNeural');
    expect(maleNames).not.toContain('en-US, BrianMultilingualNeural');
  });

  it('orders non-Multilingual before Multilingual', () => {
    const voices = [
      vo('ru-RU, DmitryNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
    ];
    const result = buildPriorityPool(voices, 'ru', new Set());

    const maleNames = result.male.map((v) => v.fullValue);
    // DmitryNeural (native, non-multi) before AndrewMultilingualNeural
    expect(maleNames.indexOf('ru-RU, DmitryNeural')).toBeLessThan(
      maleNames.indexOf('en-US, AndrewMultilingualNeural'),
    );
  });

  it('excludes reserved voices', () => {
    const voices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
    ];
    const reserved = new Set(['en-US, AndrewNeural']);
    const result = buildPriorityPool(voices, 'en', reserved);

    const maleNames = result.male.map((v) => v.fullValue);
    expect(maleNames).not.toContain('en-US, AndrewNeural');
    expect(maleNames).toContain('en-US, BrianNeural');
  });

  it('returns empty pools for empty input', () => {
    const result = buildPriorityPool([], 'en', new Set());
    expect(result.male).toHaveLength(0);
    expect(result.female).toHaveLength(0);
  });
});
