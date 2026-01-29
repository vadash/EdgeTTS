import { describe, it, expect } from 'vitest';
import { sortVoicesByPriority, randomizeBelowVoices, exportToJSON, exportToJSONSorted, normalizeForMatch, type RandomizeBelowParams } from './VoiceMappingService';
import type { VoiceOption, LLMCharacter, SpeakerAssignment } from '@/state/types';

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

describe('VoiceMappingEntry with aliases', () => {
  it('exports aliases from character variations', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'The System', variations: ['The System', 'System'], gender: 'female' },
    ];
    const voiceMap = new Map([['The System', 'en-US, MichelleNeural']]);

    const json = exportToJSON(characters, voiceMap, 'en-US, GuyNeural');
    const parsed = JSON.parse(json);

    expect(parsed.voices[0].aliases).toEqual(['The System', 'System']);
  });

  it('includes aliases in sorted export', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Cale', variations: ['Cale', 'Cale Cobbs'], gender: 'male' },
    ];
    const voiceMap = new Map([['Cale', 'en-IE, ConnorNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hello', speaker: 'Cale', voiceId: 'en-IE, ConnorNeural' },
    ];

    const json = exportToJSONSorted(characters, voiceMap, assignments, 'en-US, GuyNeural');
    const parsed = JSON.parse(json);

    expect(parsed.voices[0].aliases).toEqual(['Cale', 'Cale Cobbs']);
  });
});

describe('normalizeForMatch', () => {
  it('lowercases input', () => {
    expect(normalizeForMatch('The System')).toBe('system');
  });

  it('strips "The " prefix', () => {
    expect(normalizeForMatch('The Dark Lord')).toBe('dark lord');
  });

  it('strips "A " prefix', () => {
    expect(normalizeForMatch('A Guard')).toBe('guard');
  });

  it('strips "An " prefix', () => {
    expect(normalizeForMatch('An Elder')).toBe('elder');
  });

  it('strips title prefixes', () => {
    expect(normalizeForMatch('Professor Rinkle')).toBe('rinkle');
    expect(normalizeForMatch('Lord Azaroth')).toBe('azaroth');
    expect(normalizeForMatch('Lady Morgana')).toBe('morgana');
    expect(normalizeForMatch('King Harold')).toBe('harold');
    expect(normalizeForMatch('Queen Elizabeth')).toBe('elizabeth');
    expect(normalizeForMatch('Sir Lancelot')).toBe('lancelot');
    expect(normalizeForMatch('Instructor Solsburn')).toBe('solsburn');
  });

  it('trims whitespace', () => {
    expect(normalizeForMatch('  System  ')).toBe('system');
  });

  it('handles multiple prefixes', () => {
    expect(normalizeForMatch('The Professor Smith')).toBe('smith');
  });

  it('handles names without prefixes', () => {
    expect(normalizeForMatch('Damien')).toBe('damien');
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

  it('cycles through voices when more characters than voices', () => {
    const limitedVoices: VoiceOption[] = [
      { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
      { locale: 'en-US', name: 'DavisNeural', fullValue: 'en-US, DavisNeural', gender: 'male' },
    ];

    const manyMaleChars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: [], gender: 'female' },
      { canonicalName: 'Bob', variations: [], gender: 'male' },
      { canonicalName: 'Charlie', variations: [], gender: 'male' },
      { canonicalName: 'Dan', variations: [], gender: 'male' },
      { canonicalName: 'Eve', variations: [], gender: 'male' },
    ];

    const currentMap = new Map([['Alice', 'en-US, JennyNeural']]);

    const params: RandomizeBelowParams = {
      sortedCharacters: manyMaleChars,
      currentVoiceMap: currentMap,
      clickedIndex: 0,
      enabledVoices: limitedVoices,
      narratorVoice: 'other-voice',
      bookLanguage: 'en',
    };

    const result = randomizeBelowVoices(params);

    // Should cycle: Davis, Guy, Davis, Guy (alphabetically sorted)
    expect(result.get('Bob')).toBe('en-US, DavisNeural');
    expect(result.get('Charlie')).toBe('en-US, GuyNeural');
    expect(result.get('Dan')).toBe('en-US, DavisNeural');
    expect(result.get('Eve')).toBe('en-US, GuyNeural');
  });

  it('falls back to other gender when pool is empty', () => {
    const onlyMaleVoices: VoiceOption[] = [
      { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
    ];

    const femaleChar: LLMCharacter[] = [
      { canonicalName: 'Narrator', variations: [], gender: 'male' },
      { canonicalName: 'Alice', variations: [], gender: 'female' },
    ];

    const currentMap = new Map([['Narrator', 'other-voice']]);

    const params: RandomizeBelowParams = {
      sortedCharacters: femaleChar,
      currentVoiceMap: currentMap,
      clickedIndex: 0,
      enabledVoices: onlyMaleVoices,
      narratorVoice: 'other-voice',
      bookLanguage: 'en',
    };

    const result = randomizeBelowVoices(params);

    // Female Alice gets male voice since no female voices available
    expect(result.get('Alice')).toBe('en-US, GuyNeural');
  });

  it('does nothing when clicked on last row', () => {
    const currentMap = new Map([
      ['Narrator', 'en-US, GuyNeural'],
      ['Alice', 'en-US, JennyNeural'],
    ]);

    const params: RandomizeBelowParams = {
      sortedCharacters: characters.slice(0, 2),
      currentVoiceMap: currentMap,
      clickedIndex: 1, // Last index
      enabledVoices: allVoices,
      narratorVoice: 'other-voice',
      bookLanguage: 'en',
    };

    const result = randomizeBelowVoices(params);

    expect(result.get('Narrator')).toBe('en-US, GuyNeural');
    expect(result.get('Alice')).toBe('en-US, JennyNeural');
  });
});
