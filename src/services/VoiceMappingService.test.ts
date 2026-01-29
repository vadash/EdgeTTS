import { describe, it, expect } from 'vitest';
import { sortVoicesByPriority, randomizeBelowVoices, type RandomizeBelowParams } from './VoiceMappingService';
import type { VoiceOption, LLMCharacter } from '@/state/types';

describe('sortVoicesByPriority', () => {
  const voices: VoiceOption[] = [
    { locale: 'de-DE', name: 'ConradNeural', fullValue: 'de-DE, ConradNeural', gender: 'male' },
    { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
    { locale: 'ru-RU', name: 'DmitryNeural', fullValue: 'ru-RU, DmitryNeural', gender: 'male' },
    { locale: 'en-GB', name: 'RyanNeural', fullValue: 'en-GB, RyanNeural', gender: 'male' },
  ];

  it('puts book language voices first for English book', () => {
    const sorted = sortVoicesByPriority(voices, 'en', 'de-DE, ConradNeural');
    expect(sorted[0].locale).toBe('en-GB');
    expect(sorted[1].locale).toBe('en-US');
  });

  it('puts book language voices first for Russian book', () => {
    const sorted = sortVoicesByPriority(voices, 'ru', 'de-DE, ConradNeural');
    expect(sorted[0].locale).toBe('ru-RU');
  });

  it('excludes narrator voice from the list', () => {
    const sorted = sortVoicesByPriority(voices, 'en', 'en-US, GuyNeural');
    expect(sorted.find(v => v.fullValue === 'en-US, GuyNeural')).toBeUndefined();
  });
});

describe('randomizeBelowVoices', () => {
  const maleVoices: VoiceOption[] = [
    { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
    { locale: 'en-US', name: 'DavisNeural', fullValue: 'en-US, DavisNeural', gender: 'male' },
    { locale: 'en-US', name: 'TonyNeural', fullValue: 'en-US, TonyNeural', gender: 'male' },
  ];
  const femaleVoices: VoiceOption[] = [
    { locale: 'en-US', name: 'JennyNeural', fullValue: 'en-US, JennyNeural', gender: 'female' },
    { locale: 'en-US', name: 'AriaNeural', fullValue: 'en-US, AriaNeural', gender: 'female' },
  ];
  const allVoices = [...maleVoices, ...femaleVoices];

  const characters: LLMCharacter[] = [
    { canonicalName: 'Narrator', variations: [], gender: 'male' },
    { canonicalName: 'Alice', variations: [], gender: 'female' },
    { canonicalName: 'Bob', variations: [], gender: 'male' },
    { canonicalName: 'Carol', variations: [], gender: 'female' },
  ];

  it('randomizes voices for characters below clicked index', () => {
    const currentMap = new Map([
      ['Narrator', 'en-US, GuyNeural'],
      ['Alice', 'en-US, JennyNeural'],
      ['Bob', 'en-US, GuyNeural'],  // duplicate - will be randomized
      ['Carol', 'en-US, GuyNeural'], // duplicate - will be randomized
    ]);

    const params: RandomizeBelowParams = {
      sortedCharacters: characters,
      currentVoiceMap: currentMap,
      clickedIndex: 1, // Click on Alice, randomize Bob and Carol
      enabledVoices: allVoices,
      narratorVoice: 'en-US, GuyNeural',
      bookLanguage: 'en',
    };

    const result = randomizeBelowVoices(params);

    // Narrator and Alice should be unchanged
    expect(result.get('Narrator')).toBe('en-US, GuyNeural');
    expect(result.get('Alice')).toBe('en-US, JennyNeural');

    // Bob should get a male voice (not GuyNeural - reserved by Narrator, not JennyNeural - reserved by Alice)
    const bobVoice = result.get('Bob');
    expect(bobVoice).toBeDefined();
    expect(['en-US, DavisNeural', 'en-US, TonyNeural']).toContain(bobVoice);

    // Carol should get a female voice (not JennyNeural - reserved by Alice)
    const carolVoice = result.get('Carol');
    expect(carolVoice).toBe('en-US, AriaNeural');
  });

  it('preserves voices above clicked index', () => {
    const currentMap = new Map([
      ['Narrator', 'en-US, GuyNeural'],
      ['Alice', 'en-US, JennyNeural'],
      ['Bob', 'en-US, DavisNeural'],
      ['Carol', 'en-US, AriaNeural'],
    ]);

    const params: RandomizeBelowParams = {
      sortedCharacters: characters,
      currentVoiceMap: currentMap,
      clickedIndex: 2, // Click on Bob, only Carol randomized
      enabledVoices: allVoices,
      narratorVoice: 'en-US, TonyNeural',
      bookLanguage: 'en',
    };

    const result = randomizeBelowVoices(params);

    expect(result.get('Narrator')).toBe('en-US, GuyNeural');
    expect(result.get('Alice')).toBe('en-US, JennyNeural');
    expect(result.get('Bob')).toBe('en-US, DavisNeural');
  });
});
