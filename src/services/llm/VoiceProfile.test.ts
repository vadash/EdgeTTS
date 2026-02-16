import { describe, it, expect } from 'vitest';
import { exportToProfile, importProfile, isCharacterVisible, assignVoicesTiered, sortVoicesByPriority, randomizeBelowVoices, type RandomizeBelowParams } from './VoiceProfile';
import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment, CharacterEntry, VoiceOption } from '@/state/types';

describe('exportToProfile', () => {
  it('creates new profile when existingProfile is null', () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: [], gender: 'male' }
    ];
    const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hello', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
      { sentenceIndex: 1, text: 'World', speaker: 'narrator', voiceId: 'en-US-GuyNeural' }
    ];

    const json = exportToProfile(null, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK1');
    const profile = JSON.parse(json) as VoiceProfileFile;

    expect(profile.version).toBe(2);
    expect(profile.narrator).toBe('en-US-GuyNeural');
    expect(profile.totalLines).toBe(2);
    expect(profile.characters['harry'].canonicalName).toBe('Harry');
    expect(profile.characters['harry'].lines).toBe(1);
  });

  it('merges existing profile with new characters', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100,
      characters: {
        'harry': {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Harry P.'], gender: 'male' },
      { canonicalName: 'Ron', variations: [], gender: 'male' }
    ];
    const voiceMap = new Map([
      ['Harry', 'en-GB-RyanNeural'],
      ['Ron', 'en-US-GuyNeural']
    ]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
      { sentenceIndex: 1, text: 'Hey', speaker: 'Ron', voiceId: 'en-US-GuyNeural' }
    ];

    const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
    const profile = JSON.parse(json) as VoiceProfileFile;

    // Harry should have updated counts
    expect(profile.characters['harry'].lines).toBe(51);
    expect(profile.characters['harry'].bookAppearances).toBe(2);
    expect(profile.characters['harry'].lastSeenIn).toBe('BOOK2');

    // Ron should be added
    expect(profile.characters['ron'].canonicalName).toBe('Ron');
    expect(profile.characters['ron'].lines).toBe(1);

    // Total should include previous + current
    expect(profile.totalLines).toBe(102); // 100 + 2
  });

  it('merges aliases from current session into existing entry', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 10,
      characters: {
        'harry_potter': {
          canonicalName: 'Harry Potter',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.', 'Harry'],
          lines: 10,
          percentage: 100,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry Potter', variations: ['Harry', 'Potter', 'The Boy Who Lived'], gender: 'male' }
    ];
    const voiceMap = new Map([['Harry Potter', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry Potter', voiceId: 'en-GB-RyanNeural' }
    ];

    const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
    const profile = JSON.parse(json) as VoiceProfileFile;

    expect(profile.characters['harry_potter'].aliases).toContain('Harry P.');
    expect(profile.characters['harry_potter'].aliases).toContain('Harry');
    expect(profile.characters['harry_potter'].aliases).toContain('Potter');
    expect(profile.characters['harry_potter'].aliases).toContain('The Boy Who Lived');
  });

  it('calculates percentage correctly for merged profile', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100, // Harry has 50 lines = 50%
      characters: {
        'harry': {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Harry P.'], gender: 'male' }
    ];
    const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' }
    ];

    const json = exportToProfile(existingProfile, characters, voiceMap, assignments, 'en-US-GuyNeural', 'BOOK2');
    const profile = JSON.parse(json) as VoiceProfileFile;

    // Total: 101 lines, Harry: 51 lines = 51/101 ≈ 50.495%
    expect(profile.totalLines).toBe(101);
    expect(profile.characters['harry'].lines).toBe(51);
    expect(Math.abs(profile.characters['harry'].percentage - 50.495)).toBeLessThan(0.01);
  });
});

describe('importProfile', () => {
  it('returns empty maps for empty profile', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 0,
      characters: {}
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: [], gender: 'male' }
    ];

    const result = importProfile(JSON.stringify(profile), characters);

    expect(result.voiceMap.size).toBe(0);
    expect(result.matchedCharacters.size).toBe(0);
    expect(result.unmatchedCharacters).toHaveLength(1);
  });

  it('matches characters by exact name', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100,
      characters: {
        'harry': {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.', 'Potter'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Potter'], gender: 'male' }
    ];

    const result = importProfile(JSON.stringify(profile), characters);

    expect(result.voiceMap.get('Harry')).toBe('en-GB-RyanNeural');
    expect(result.matchedCharacters.has('Harry')).toBe(true);
    expect(result.unmatchedCharacters).toHaveLength(0);
  });

  it('matches characters with alias variations', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100,
      characters: {
        'mae': {
          canonicalName: 'Mae',
          voice: 'en-US-JennyNeural',
          gender: 'female',
          aliases: ['Mai'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    // May/Mae/TheMay vs Mae/Mai - should match with 2 pairings
    const characters: LLMCharacter[] = [
      { canonicalName: 'May', variations: ['Mae', 'The May'], gender: 'female' }
    ];

    const result = importProfile(JSON.stringify(profile), characters);

    expect(result.voiceMap.get('May')).toBe('en-US-JennyNeural');
    expect(result.matchedCharacters.has('May')).toBe(true);
  });

  it('leaves unmatched characters in unmatchedCharacters array', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100,
      characters: {
        'harry': {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: [],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: [], gender: 'male' },
      { canonicalName: 'Ron', variations: [], gender: 'male' }
    ];

    const result = importProfile(JSON.stringify(profile), characters);

    expect(result.voiceMap.get('Harry')).toBe('en-GB-RyanNeural');
    expect(result.unmatchedCharacters).toContain('Ron');
    expect(result.unmatchedCharacters).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => {
      importProfile('invalid json', []);
    }).toThrow();
  });

  it('throws on v1 format with clear error message', () => {
    const v1Json = JSON.stringify({
      version: 1,
      narrator: 'en-US, GuyNeural',
      voices: [{ name: 'Harry', voice: 'en-GB-RyanNeural', gender: 'male' }]
    });

    expect(() => {
      importProfile(v1Json, []);
    }).toThrow('Unsupported voice profile format. Re-export from a current session.');
  });

  it('throws on missing version field', () => {
    const noVersionJson = JSON.stringify({
      narrator: 'en-US, GuyNeural',
      characters: {}
    });

    expect(() => {
      importProfile(noVersionJson, []);
    }).toThrow('Unsupported voice profile format');
  });
});

import { IMPORTANCE_THRESHOLD } from '@/state/types';

describe('isCharacterVisible', () => {
  it('returns false for characters below threshold', () => {
    const entry: CharacterEntry = {
      canonicalName: 'Minor',
      voice: 'en-US-GuyNeural',
      gender: 'male',
      aliases: [],
      lines: 1,
      percentage: 0.003, // Below 0.5% (0.5% = 0.005)
      lastSeenIn: 'BOOK1',
      bookAppearances: 1
    };

    expect(isCharacterVisible(entry)).toBe(false);
  });

  it('returns true for characters at or above threshold', () => {
    const entry1: CharacterEntry = {
      canonicalName: 'Important',
      voice: 'en-US-GuyNeural',
      gender: 'male',
      aliases: [],
      lines: 10,
      percentage: 0.5, // Exactly threshold
      lastSeenIn: 'BOOK1',
      bookAppearances: 1
    };

    const entry2: CharacterEntry = {
      canonicalName: 'Main',
      voice: 'en-US-GuyNeural',
      gender: 'male',
      aliases: [],
      lines: 100,
      percentage: 15.0,
      lastSeenIn: 'BOOK1',
      bookAppearances: 1
    };

    expect(isCharacterVisible(entry1)).toBe(true);
    expect(isCharacterVisible(entry2)).toBe(true);
  });

  it('uses IMPORTANCE_THRESHOLD constant', () => {
    const entry: CharacterEntry = {
      canonicalName: 'Threshold',
      voice: 'en-US-GuyNeural',
      gender: 'male',
      aliases: [],
      lines: 5,
      percentage: IMPORTANCE_THRESHOLD,
      lastSeenIn: 'BOOK1',
      bookAppearances: 1
    };

    expect(isCharacterVisible(entry)).toBe(true);
  });
});

describe('assignVoicesTiered', () => {
  const createVoiceOptions = (): VoiceOption[] => [
    { locale: 'en-US', name: 'Voice1', fullValue: 'voice-1', gender: 'male' },
    { locale: 'en-US', name: 'Voice2', fullValue: 'voice-2', gender: 'male' },
    { locale: 'en-US', name: 'Voice3', fullValue: 'voice-3', gender: 'male' },
  ];

  const createCharacterEntries = (): CharacterEntry[] => [
    { canonicalName: 'Main1', voice: '', gender: 'male', aliases: [], lines: 100, percentage: 50, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    { canonicalName: 'Main2', voice: '', gender: 'male', aliases: [], lines: 80, percentage: 40, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    { canonicalName: 'Main3', voice: '', gender: 'male', aliases: [], lines: 60, percentage: 30, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    { canonicalName: 'Minor1', voice: '', gender: 'male', aliases: [], lines: 5, percentage: 2.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    { canonicalName: 'Minor2', voice: '', gender: 'male', aliases: [], lines: 3, percentage: 1.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
  ];

  it('assigns unique voices to top N characters (N = voice count)', () => {
    const voices = createVoiceOptions();
    const characters = createCharacterEntries();
    const narratorVoice = 'narrator-voice';

    const result = assignVoicesTiered(characters, voices, narratorVoice);

    // Top 3 get unique voices
    expect(result.get('Main1')?.shared).toBe(false);
    expect(result.get('Main2')?.shared).toBe(false);
    expect(result.get('Main3')?.shared).toBe(false);

    // They should have different voices
    const main1Voice = result.get('Main1')?.voice;
    const main2Voice = result.get('Main2')?.voice;
    const main3Voice = result.get('Main3')?.voice;
    expect(new Set([main1Voice, main2Voice, main3Voice]).size).toBe(3);
  });

  it('assigns shared voices to remaining characters', () => {
    const voices = createVoiceOptions();
    const characters = createCharacterEntries();
    const narratorVoice = 'narrator-voice';

    const result = assignVoicesTiered(characters, voices, narratorVoice);

    // Minor characters should be marked as shared
    expect(result.get('Minor1')?.shared).toBe(true);
    expect(result.get('Minor2')?.shared).toBe(true);
  });

  it('cycles through voices for shared assignments', () => {
    const voices = createVoiceOptions();
    const characters: CharacterEntry[] = [
      ...createCharacterEntries().slice(0, 3), // 3 main characters
      { canonicalName: 'Minor1', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Minor2', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Minor3', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Minor4', voice: '', gender: 'male', aliases: [], lines: 1, percentage: 0.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    ];
    const narratorVoice = 'narrator-voice';

    const result = assignVoicesTiered(characters, voices, narratorVoice);

    // Minor 1-4 should cycle through voices 1-3
    const minorVoices = ['Minor1', 'Minor2', 'Minor3', 'Minor4'].map(
      name => result.get(name)?.voice
    );
    // All should be one of the available voices
    for (const voice of minorVoices) {
      expect(voices.map(v => v.fullValue)).toContain(voice);
    }
  });

  it('sorts characters by line count descending', () => {
    const voices = createVoiceOptions();
    const characters: CharacterEntry[] = [
      { canonicalName: 'LowLines', voice: '', gender: 'male', aliases: [], lines: 5, percentage: 2.5, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'HighLines', voice: '', gender: 'male', aliases: [], lines: 200, percentage: 80, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'MidLines', voice: '', gender: 'male', aliases: [], lines: 100, percentage: 50, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    ];
    const narratorVoice = 'narrator-voice';

    const result = assignVoicesTiered(characters, voices, narratorVoice);

    // All 3 characters get unique voices (3 voices, 3 characters)
    expect(result.get('HighLines')?.shared).toBe(false);
    expect(result.get('MidLines')?.shared).toBe(false);
    expect(result.get('LowLines')?.shared).toBe(false);

    // Verify they have different voices
    const highVoice = result.get('HighLines')?.voice;
    const midVoice = result.get('MidLines')?.voice;
    const lowVoice = result.get('LowLines')?.voice;
    expect(new Set([highVoice, midVoice, lowVoice]).size).toBe(3);
  });

  it('filters out narrator voice from assignments', () => {
    const voices = createVoiceOptions();
    const characters: CharacterEntry[] = [
      { canonicalName: 'Narrator', voice: 'narrator-voice', gender: 'male', aliases: [], lines: 500, percentage: 90, lastSeenIn: 'BOOK1', bookAppearances: 1 },
      { canonicalName: 'Character', voice: '', gender: 'male', aliases: [], lines: 50, percentage: 10, lastSeenIn: 'BOOK1', bookAppearances: 1 },
    ];
    const narratorVoice = 'narrator-voice';

    const result = assignVoicesTiered(characters, voices, narratorVoice);

    // Narrator should not be in result
    expect(result.has('Narrator')).toBe(false);

    // Character should get unique voice (since narrator filtered out)
    expect(result.get('Character')?.shared).toBe(false);
  });
});

describe('Module exports', () => {
  it('exports all required functions', async () => {
    const module = await import('./VoiceProfile');

    expect(typeof module.exportToProfile).toBe('function');
    expect(typeof module.importProfile).toBe('function');
    expect(typeof module.isCharacterVisible).toBe('function');
    expect(typeof module.assignVoicesTiered).toBe('function');
  });
});

describe('Module exports (moved utilities)', () => {
  it('exports moved utility functions', async () => {
    const module = await import('./VoiceProfile');

    expect(typeof module.sortVoicesByPriority).toBe('function');
    expect(typeof module.randomizeBelowVoices).toBe('function');
    expect(typeof module.downloadJSON).toBe('function');
    expect(typeof module.readJSONFile).toBe('function');
  });
});

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
