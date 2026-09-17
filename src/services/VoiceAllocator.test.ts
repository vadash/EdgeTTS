import { describe, expect, it } from 'vitest';
import type { LLMCharacter, VoiceOption, VoicePool } from '@/state/types';
import {
  allocateVoices,
  assignUnmatchedFromPool,
  buildPriorityPool,
  randomizeBelow,
  uniqueSlotCount,
  VoicePoolTracker,
} from './VoiceAllocator';

describe('VoicePoolTracker', () => {
  const pool: VoicePool = {
    male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, AndrewMultilingualNeural'],
    female: ['en-US, AvaNeural', 'en-US, JennyNeural'],
  };

  describe('pickVoice', () => {
    it('picks voices sequentially from pool (first available, not random)', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, AndrewNeural');

      const second = tracker.pickVoice('male');
      expect(second).toBe('en-US, BrianNeural');

      const third = tracker.pickVoice('male');
      expect(third).toBe('en-US, AndrewMultilingualNeural');
    });

    it('respects reserved voices when picking sequentially', () => {
      const reserved = new Set(['en-US, AndrewNeural']);
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural', reserved);

      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, BrianNeural');
    });

    it('cycles through pool when exhausted', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      tracker.pickVoice('female');
      tracker.pickVoice('female');

      // The pool is exhausted, so this pick cycles back to the start.
      const reused = tracker.pickVoice('female');
      expect(pool.female).toContain(reused);
    });

    it('narrator voice is always reserved', () => {
      const smallPool: VoicePool = {
        male: ['en-US, NarratorNeural', 'en-US, BrianNeural'],
        female: [],
      };
      const tracker = new VoicePoolTracker(smallPool, 'en-US, NarratorNeural');

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
    expect(maleNames.indexOf('ru-RU, DmitryNeural')).toBeLessThan(
      maleNames.indexOf('en-US, AndrewMultilingualNeural'),
    );
  });

  it('excludes reserved voices', () => {
    const voices = [vo('en-US, AndrewNeural', 'male'), vo('en-US, BrianNeural', 'male')];
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

  // Frequencies descend in list order, so the allocation order is deterministic.
  const freq = (chars: LLMCharacter[]): Map<string, number> =>
    new Map(chars.map((c, i) => [c.canonicalName, 1000 - i * 10]));

  it('assigns native voices before Multilingual voices', () => {
    const chars = [
      mkChar('Alice', 'female'), // at the clicked index, so her voice is frozen
      mkChar('Bob', 'male'), // randomized
      mkChar('Charlie', 'male'), // randomized
      mkChar('Dave', 'male'), // randomized
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

    const result = randomizeBelow(
      chars,
      currentMap,
      0,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
      freq(chars),
    );

    const bobVoice = result.get('Bob')!;
    expect(bobVoice).not.toContain('Multilingual');

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
    const chars = [mkChar('Bob', 'male'), mkChar('Charlie', 'male')];
    const currentMap = new Map<string, string>();
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
    ];

    const result = randomizeBelow(
      chars,
      currentMap,
      -1,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
      freq(chars),
    );

    const assignedVoices = [...result.values()];
    const hasAndrew = assignedVoices.includes('en-US, AndrewNeural');
    const hasAndrewMulti = assignedVoices.includes('en-US, AndrewMultilingualNeural');
    expect(hasAndrew && hasAndrewMulti).toBe(false);
  });

  it('shuffle=true produces different ordering across runs (statistical)', () => {
    // Repeating one exact order across runs has probability about 1/n!, so a
    // different order appears within a few runs.
    const chars = [
      mkChar('A', 'male'),
      mkChar('B', 'male'),
      mkChar('C', 'male'),
      mkChar('D', 'male'),
    ];
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
      vo('en-US, TonyNeural', 'male'),
      vo('en-US, DavisNeural', 'male'),
    ];
    const currentMap = new Map<string, string>();
    const first = randomizeBelow(
      chars,
      currentMap,
      -1,
      enabledVoices,
      'narrator',
      'en',
      freq(chars),
      true,
    );
    const firstOrder = [first.get('A'), first.get('B'), first.get('C'), first.get('D')].join(',');

    let sawDifferent = false;
    for (let i = 0; i < 20; i++) {
      const run = randomizeBelow(
        chars,
        currentMap,
        -1,
        enabledVoices,
        'narrator',
        'en',
        freq(chars),
        true,
      );
      const order = [run.get('A'), run.get('B'), run.get('C'), run.get('D')].join(',');
      if (order !== firstOrder) {
        sawDifferent = true;
        break;
      }
    }
    expect(sawDifferent).toBe(true);
  });

  it('shuffle=true never assigns Multilingual before native for same locale', () => {
    const chars = [mkChar('A', 'male'), mkChar('B', 'male'), mkChar('C', 'male')];
    const enabledVoices = [
      vo('en-US, AndrewNeural', 'male'),
      vo('en-US, AndrewMultilingualNeural', 'male'),
      vo('en-US, BrianNeural', 'male'),
      vo('en-US, BrianMultilingualNeural', 'male'),
      vo('en-US, GuyNeural', 'male'),
    ];
    const currentMap = new Map<string, string>();

    for (let i = 0; i < 30; i++) {
      const result = randomizeBelow(
        chars,
        currentMap,
        -1,
        enabledVoices,
        'narrator',
        'en',
        freq(chars),
        true,
      );
      const assigned = [result.get('A')!, result.get('B')!, result.get('C')!];
      const firstMultiIdx = assigned.findIndex((v) => v.includes('Multilingual'));
      const lastNativeIdx = assigned.reduce(
        (last, v, idx) => (!v.includes('Multilingual') ? idx : last),
        -1,
      );
      if (firstMultiIdx !== -1 && lastNativeIdx !== -1) {
        expect(lastNativeIdx).toBeLessThan(firstMultiIdx);
      }
    }
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
    const chars = [mkChar('Alice', 'female'), mkChar('Bob', 'male'), mkChar('Charlie', 'male')];
    const importedMap = new Map([['Alice', 'en-US, JennyNeural']]);
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

    expect(result.get('Alice')).toBe('en-US, JennyNeural');
    expect(result.get('Bob')).toBe('en-US, AndrewNeural');
    expect(result.get('Charlie')).toBe('en-US, BrianNeural');
  });

  it('replaces imported voices not in enabled list', () => {
    const chars = [mkChar('Alice', 'female')];
    const importedMap = new Map([
      ['Alice', 'de-DE, KatjaNeural'], // not in enabled list
    ]);
    const enabledVoices = [vo('en-US, JennyNeural', 'female'), vo('en-US, AriaNeural', 'female')];

    const result = assignUnmatchedFromPool(
      chars,
      importedMap,
      enabledVoices,
      'en-US, NarratorNeural',
      'en',
    );

    expect(result.get('Alice')).toBe('en-US, JennyNeural');
  });

  it('deduplicates Multilingual pairs in assignment', () => {
    const chars = [mkChar('Bob', 'male'), mkChar('Charlie', 'male')];
    const importedMap = new Map<string, string>();
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

describe('allocateVoices', () => {
  const _vo = (fullValue: string, gender: 'male' | 'female'): VoiceOption => {
    const [locale, name] = fullValue.split(', ');
    return { locale, name, fullValue, gender };
  };

  const mkChar = (name: string, gender: 'male' | 'female' | 'unknown'): LLMCharacter => ({
    canonicalName: name,
    variations: [name],
    gender,
  });

  it('assigns voices in input order when frequency is absent', () => {
    const chars = [mkChar('Bob', 'male'), mkChar('Alice', 'female')];
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural'],
      female: ['en-US, JennyNeural', 'en-US, AvaNeural'],
    };

    const result = allocateVoices({
      characters: chars,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
    });

    expect(result.voiceMap.get('Bob')).toBe('en-US, AndrewNeural');
    expect(result.voiceMap.get('Alice')).toBe('en-US, JennyNeural');
  });

  it('assigns unique voices to the top 80% of characters, rest cycle pool', () => {
    const chars = [
      mkChar('Alice', 'female'),
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
      mkChar('David', 'male'),
      mkChar('Eve', 'female'),
      mkChar('Frank', 'male'),
      mkChar('Grace', 'female'),
      mkChar('Henry', 'male'),
    ];
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, GuyNeural'],
      female: ['en-US, JennyNeural', 'en-US, AvaNeural'],
    };
    const frequency = new Map<string, number>([
      ['Alice', 100],
      ['Bob', 80],
      ['Charlie', 60],
      ['David', 40],
      ['Eve', 20],
      ['Frank', 10],
      ['Grace', 5],
      ['Henry', 1],
    ]);

    // A pool of 5 gives 4 unique slots (80%), so the shared tail cycles.
    const result = allocateVoices({
      characters: chars,
      frequency,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
    });

    const aliceVoice = result.voiceMap.get('Alice');
    expect(aliceVoice).toBeTruthy();

    const allVoices = [...result.voiceMap.values()].filter((v) => !v.includes('UNNAMED'));
    expect(new Set(allVoices).size).toBeGreaterThan(1);
  });

  it('respects reserved voices when pool has sufficient alternatives', () => {
    const chars = [
      mkChar('Alice', 'female'),
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
      mkChar('David', 'male'),
    ];
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, GuyNeural'],
      female: ['en-US, JennyNeural'],
    };
    const frequency = new Map<string, number>([
      ['Alice', 100],
      ['Bob', 50],
      ['Charlie', 30],
      ['David', 20],
    ]);
    const reserved = new Set(['en-US, AndrewNeural']);

    const result = allocateVoices({
      characters: chars,
      frequency,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
      reservedVoices: reserved,
    });

    expect(result.voiceMap.get('Bob')).not.toBe('en-US, AndrewNeural');
    expect(result.voiceMap.get('Charlie')).not.toBe('en-US, AndrewNeural');
    // David can cycle to the reserved voice once the pool exhausts, so no
    // assertion pins him.
  });

  it('cycles pool when exhausted for many characters', () => {
    const chars = Array.from({ length: 20 }, (_, i) =>
      mkChar(`Char${i}`, i % 2 === 0 ? 'male' : 'female'),
    );
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural'],
      female: ['en-US, JennyNeural', 'en-US, AvaNeural'],
    };
    const frequency = new Map<string, number>(
      chars.map((c) => [c.canonicalName, Math.floor(Math.random() * 100)]),
    );

    const result = allocateVoices({
      characters: chars,
      frequency,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
    });

    expect(result.voiceMap.size).toBeGreaterThan(0);

    // The pool is smaller than the character count, so voices must be reused.
    const assignedVoices = [...result.voiceMap.values()].filter((v) => !v.includes('UNNAMED'));
    expect(new Set(assignedVoices).size).toBeLessThan(chars.length);
  });

  it('adds rare/unnamed speaker voices', () => {
    const chars = [mkChar('Alice', 'female')];
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural'],
      female: ['en-US, JennyNeural'],
    };
    const frequency = new Map<string, number>([['Alice', 100]]);

    const result = allocateVoices({
      characters: chars,
      frequency,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
    });

    expect(result.voiceMap.get('MALE_UNNAMED')).toBe('en-US, AndrewNeural');
    expect(result.rareVoices.male).toBeTruthy();
    expect(result.rareVoices.female).toBeTruthy();
    expect(result.rareVoices.unknown).toBeTruthy();
  });

  it('respects custom top percentage', () => {
    const chars = [
      mkChar('Alice', 'female'),
      mkChar('Bob', 'male'),
      mkChar('Charlie', 'male'),
      mkChar('David', 'male'),
      mkChar('Eve', 'female'),
    ];
    const pool: VoicePool = {
      male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, GuyNeural'],
      female: ['en-US, JennyNeural', 'en-US, AvaNeural'],
    };
    const frequency = new Map<string, number>(
      chars.map((c, i) => [c.canonicalName, (chars.length - i) * 10]),
    );

    const result = allocateVoices({
      characters: chars,
      frequency,
      pool,
      narratorVoice: 'en-US, NarratorNeural',
    });

    const assignedVoices = [...result.voiceMap.values()].filter((v) => !v.includes('UNNAMED'));
    expect(new Set(assignedVoices).size).toBeGreaterThan(1);
  });
});

describe('uniqueSlotCount', () => {
  it('is 80% of the pool size, rounded up', () => {
    expect(uniqueSlotCount(5)).toBe(4);
  });

  it('never drops below one voice', () => {
    expect(uniqueSlotCount(1)).toBe(1);
  });
});
