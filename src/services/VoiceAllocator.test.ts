import { describe, expect, it } from 'vitest';
import type { VoicePool, VoiceOption, LLMCharacter } from '@/state/types';
import { VoicePoolTracker, buildPriorityPool, randomizeBelow, assignUnmatchedFromPool } from './VoiceAllocator';

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

describe('randomizeBelow', () => {
  const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  const mkChar = (name: string, gender: 'male' | 'female' | 'unknown'): LLMCharacter => ({
    canonicalName: name,
    variations: [name],
    gender,
  });

  it('assigns native voices before Multilingual voices', () => {
    const chars = [
      mkChar('Alice', 'female'), // index 0 — frozen
      mkChar('Bob', 'male'), // index 1 — randomized
      mkChar('Charlie', 'male'), // index 2 — randomized
      mkChar('Dave', 'male'), // index 3 — randomized
    ];
    const currentMap = new Map([
      ['Alice', 'en-US, JennyNeural'],
      ['Bob', 'en-US, AndrewMultilingualNeural'],
      ['Charlie', 'en-US, BrianMultilingualNeural'],
      ['Dave', 'en-US, GuyNeural'],
    ]);
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, BrianMultilingualNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
      vo('en-US, JennyNeural', 'female'),
    ];

    const result = randomizeBelow(chars, currentMap, 0, enabledVoices, 'en-US, NarratorNeural', 'en');

    // Bob (index 1) should get a native voice, not a Multilingual one
    const bobVoice = result.get('Bob')!;
    expect(bobVoice).not.toContain('Multilingual');

    // All non-Multilingual male voices should be used before any Multilingual
    const assignedMales = [result.get('Bob')!, result.get('Charlie')!, result.get('Dave')!];
    const firstMultiIdx = assignedMales.findIndex((v) => v.includes('Multilingual'));
    const lastNativeIdx = assignedMales.reduce(
      (last, v, i) => (!v.includes('Multilingual') ? i : last),
      -1,
    );
    if (firstMultiIdx !== -1 && lastNativeIdx !== -1) {
      expect(lastNativeIdx).toBeLessThan(firstMultiIdx);
    }
  });

  it('deduplicates variant pairs — never assigns both Andrew and AndrewMultilingual', () => {
    const chars = [
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
    ];
    const currentMap = new Map<string, string>();
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
    ];

    const result = randomizeBelow(chars, currentMap, -1, enabledVoices, 'en-US, NarratorNeural', 'en');

    const assignedVoices = [...result.values()];
    const hasAndrew = assignedVoices.includes('en-US, AndrewNeural');
    const hasAndrewMulti = assignedVoices.includes('en-US, AndrewMultilingualNeural');
    // At most one of the pair should be assigned
    expect(hasAndrew && hasAndrewMulti).toBe(false);
  });
});

describe('assignUnmatchedFromPool', () => {
  const vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  const mkChar = (name: string, gender: 'male' | 'female' | 'unknown'): LLMCharacter => ({
    canonicalName: name,
    variations: [name],
    gender,
  });

  it('assigns unmatched characters from priority pool sequentially', () => {
    const chars = [
      mkChar('Alice', 'female'),
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
    ];
    const importedMap = new Map([
      ['Alice', 'en-US, JennyNeural'],
      // Bob and Charlie are unmatched
    ]);
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, JennyNeural', 'female'),
    ];

    const result = assignUnmatchedFromPool(
      chars,
      importedMap,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
    );

    expect(result.get('Alice')).toBe('en-US, JennyNeural'); // preserved
    expect(result.get('Bob')).toBe('en-US, AndrewNeural'); // first available male
    expect(result.get('Charlie')).toBe('en-US, BrianNeural'); // second available male
  });

  it('replaces imported voices not in enabled list', () => {
    const chars = [
      mkChar('Alice', 'female'),
    ];
    const importedMap = new Map([
      ['Alice', 'de-DE, KatjaNeural'], // not in enabled list
    ]);
    const enabledVoices = [
      vo('en-US, JennyNeural', 'female'),
      vo('en-US, AriaNeural', 'female'),
    ];

    const result = assignUnmatchedFromPool(
      chars,
      importedMap,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
    );

    // Alice's voice should be replaced with an enabled voice
    expect(result.get('Alice')).toBe('en-US, JennyNeural');
  });

  it('deduplicates Multilingual pairs in assignment', () => {
    const chars = [
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
    ];
    const importedMap = new Map<string, string>(); // all unmatched
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
    ];

    const result = assignUnmatchedFromPool(
      chars,
      importedMap,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
    );

    const assignedVoices = [...result.values()];
    const hasAndrew = assignedVoices.includes('en-US, AndrewNeural');
    const hasAndrewMulti = assignedVoices.includes('en-US, AndrewMultilingualNeural');
    expect(hasAndrew && hasAndrewMulti).toBe(false);
  });
});
