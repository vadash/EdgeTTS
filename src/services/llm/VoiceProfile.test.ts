import { describe, expect, it } from 'vitest';
import type {
  CharacterEntry,
  LLMCharacter,
  SpeakerAssignment,
  VoiceOption,
  VoiceProfileFile,
} from '@/state/types';
import { randomizeBelow } from '../VoiceAllocator';
import { exportToProfile, importProfile, isCharacterVisible } from './VoiceProfile';

describe('exportToProfile', () => {
  it('creates new profile when existingProfile is null', () => {
    const characters: LLMCharacter[] = [{ canonicalName: 'Harry', variations: [], gender: 'male' }];
    const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hello', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
      { sentenceIndex: 1, text: 'World', speaker: 'narrator', voiceId: 'en-US-GuyNeural' },
    ];

    const json = exportToProfile(
      null,
      characters,
      voiceMap,
      assignments,
      'en-US-GuyNeural',
      'BOOK1',
    );
    const profile = JSON.parse(json) as VoiceProfileFile;

    expect(profile.version).toBe(2);
    expect(profile.narrator).toBe('en-US-GuyNeural');
    expect(profile.totalLines).toBe(2);
    expect(profile.characters.harry.canonicalName).toBe('Harry');
    expect(profile.characters.harry.lines).toBe(1);
  });

  it('merges existing profile with new characters', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100,
      characters: {
        harry: {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Harry P.'], gender: 'male' },
      { canonicalName: 'Ron', variations: [], gender: 'male' },
    ];
    const voiceMap = new Map([
      ['Harry', 'en-GB-RyanNeural'],
      ['Ron', 'en-US-GuyNeural'],
    ]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
      { sentenceIndex: 1, text: 'Hey', speaker: 'Ron', voiceId: 'en-US-GuyNeural' },
    ];

    const json = exportToProfile(
      existingProfile,
      characters,
      voiceMap,
      assignments,
      'en-US-GuyNeural',
      'BOOK2',
    );
    const profile = JSON.parse(json) as VoiceProfileFile;

    // Harry should have updated counts
    expect(profile.characters.harry.lines).toBe(51);
    expect(profile.characters.harry.bookAppearances).toBe(2);
    expect(profile.characters.harry.lastSeenIn).toBe('BOOK2');

    // Ron should be added
    expect(profile.characters.ron.canonicalName).toBe('Ron');
    expect(profile.characters.ron.lines).toBe(1);

    // Total should include previous + current
    expect(profile.totalLines).toBe(102); // 100 + 2
  });

  it('merges aliases from current session into existing entry', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 10,
      characters: {
        harry_potter: {
          canonicalName: 'Harry Potter',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.', 'Harry'],
          lines: 10,
          percentage: 100,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    const characters: LLMCharacter[] = [
      {
        canonicalName: 'Harry Potter',
        variations: ['Harry', 'Potter', 'The Boy Who Lived'],
        gender: 'male',
      },
    ];
    const voiceMap = new Map([['Harry Potter', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry Potter', voiceId: 'en-GB-RyanNeural' },
    ];

    const json = exportToProfile(
      existingProfile,
      characters,
      voiceMap,
      assignments,
      'en-US-GuyNeural',
      'BOOK2',
    );
    const profile = JSON.parse(json) as VoiceProfileFile;

    expect(profile.characters.harry_potter.aliases).toContain('Harry P.');
    expect(profile.characters.harry_potter.aliases).toContain('Harry');
    expect(profile.characters.harry_potter.aliases).toContain('Potter');
    expect(profile.characters.harry_potter.aliases).toContain('The Boy Who Lived');
  });

  it('calculates percentage correctly for merged profile', () => {
    const existingProfile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 100, // Harry has 50 lines = 50%
      characters: {
        harry: {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Harry P.'], gender: 'male' },
    ];
    const voiceMap = new Map([['Harry', 'en-GB-RyanNeural']]);
    const assignments: SpeakerAssignment[] = [
      { sentenceIndex: 0, text: 'Hi', speaker: 'Harry', voiceId: 'en-GB-RyanNeural' },
    ];

    const json = exportToProfile(
      existingProfile,
      characters,
      voiceMap,
      assignments,
      'en-US-GuyNeural',
      'BOOK2',
    );
    const profile = JSON.parse(json) as VoiceProfileFile;

    // Total: 101 lines, Harry: 51 lines = 51/101 ≈ 50.495%
    expect(profile.totalLines).toBe(101);
    expect(profile.characters.harry.lines).toBe(51);
    expect(Math.abs(profile.characters.harry.percentage - 50.495)).toBeLessThan(0.01);
  });
});

describe('importProfile', () => {
  it('returns empty maps for empty profile', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 0,
      characters: {},
    };

    const characters: LLMCharacter[] = [{ canonicalName: 'Harry', variations: [], gender: 'male' }];

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
        harry: {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry P.', 'Potter'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: ['Potter'], gender: 'male' },
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
        mae: {
          canonicalName: 'Mae',
          voice: 'en-US-JennyNeural',
          gender: 'female',
          aliases: ['Mai'],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    // May/Mae/TheMay vs Mae/Mai - should match with 2 pairings
    const characters: LLMCharacter[] = [
      { canonicalName: 'May', variations: ['Mae', 'The May'], gender: 'female' },
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
        harry: {
          canonicalName: 'Harry',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: [],
          lines: 50,
          percentage: 50,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1,
        },
      },
    };

    const characters: LLMCharacter[] = [
      { canonicalName: 'Harry', variations: [], gender: 'male' },
      { canonicalName: 'Ron', variations: [], gender: 'male' },
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
      voices: [{ name: 'Harry', voice: 'en-GB-RyanNeural', gender: 'male' }],
    });

    expect(() => {
      importProfile(v1Json, []);
    }).toThrow('Unsupported voice profile format. Re-export from a current session.');
  });

  it('throws on missing version field', () => {
    const noVersionJson = JSON.stringify({
      narrator: 'en-US, GuyNeural',
      characters: {},
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
      bookAppearances: 1,
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
      bookAppearances: 1,
    };

    const entry2: CharacterEntry = {
      canonicalName: 'Main',
      voice: 'en-US-GuyNeural',
      gender: 'male',
      aliases: [],
      lines: 100,
      percentage: 15.0,
      lastSeenIn: 'BOOK1',
      bookAppearances: 1,
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
      bookAppearances: 1,
    };

    expect(isCharacterVisible(entry)).toBe(true);
  });
});

describe('randomizeBelow', () => {
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

  // Mirrors the ordering the deleted in-function fallback synthesized (1000 - 10*index)
  // so existing assertions hold unchanged now that frequency is required.
  const freq = (chars: LLMCharacter[]): Map<string, number> =>
    new Map(chars.map((c, i) => [c.canonicalName, 1000 - i * 10]));

  it('randomizes voices for characters below clicked index', () => {
    const currentMap = new Map([
      ['Narrator', 'en-US, GuyNeural'],
      ['Alice', 'en-US, JennyNeural'],
      ['Bob', 'en-US, GuyNeural'], // duplicate - will be randomized
      ['Carol', 'en-US, GuyNeural'], // duplicate - will be randomized
    ]);

    const result = randomizeBelow(
      characters,
      currentMap,
      1, // Click on Alice, randomize Bob and Carol
      allVoices,
      'en-US, GuyNeural',
      'en',
      freq(characters),
    );

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

    const result = randomizeBelow(
      characters,
      currentMap,
      2, // Click on Bob, only Carol randomized
      allVoices,
      'en-US, TonyNeural',
      'en',
      freq(characters),
    );

    expect(result.get('Narrator')).toBe('en-US, GuyNeural');
    expect(result.get('Alice')).toBe('en-US, JennyNeural');
    expect(result.get('Bob')).toBe('en-US, DavisNeural');
  });

  it('reserves 80% unique, cycles the 20% tail for overflow', () => {
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

    const result = randomizeBelow(
      manyMaleChars,
      currentMap,
      0,
      limitedVoices,
      'other-voice',
      'en',
      freq(manyMaleChars),
    );

    // 2-voice pool: 80% cut rounds up to 2, split forces unique=[Guy], shared=[Davis].
    expect(result.get('Bob')).toBe('en-US, GuyNeural'); // unique slot
    // Dan and Eve must come from the shared tail — repeats allowed, never re-uses the unique.
    expect(['en-US, GuyNeural', 'en-US, DavisNeural']).toContain(result.get('Charlie'));
    expect(['en-US, GuyNeural', 'en-US, DavisNeural']).toContain(result.get('Dan'));
    expect(['en-US, GuyNeural', 'en-US, DavisNeural']).toContain(result.get('Eve'));
  });

  it('with 10 voices and 10 chars, the top 80% (8) get distinct voices; tail comes from shared 20%', () => {
    const voices: VoiceOption[] = Array.from({ length: 10 }, (_, i) => ({
      locale: 'en-US',
      name: `M${i}Neural`,
      fullValue: `en-US, M${i}Neural`,
      gender: 'male',
    }));
    const chars: LLMCharacter[] = [
      { canonicalName: 'Narrator', variations: [], gender: 'male' },
      ...Array.from({ length: 10 }, (_, i) => ({
        canonicalName: `C${i}`,
        variations: [],
        gender: 'male' as const,
      })),
    ];
    const currentMap = new Map([['Narrator', 'en-US, NarratorNeural']]);

    const result = randomizeBelow(
      chars,
      currentMap,
      -1,
      voices,
      'en-US, NarratorNeural',
      'en',
      freq(chars),
    );

    const assigned = chars.slice(1).map((c) => result.get(c.canonicalName)!);
    expect(new Set(assigned).size).toBe(9); // 9 unique + 1-voice shared tail
    expect(assigned.every((v) => v.startsWith('en-US, M'))).toBe(true);
    expect(assigned.every((v) => v !== 'en-US, NarratorNeural')).toBe(true);
  });

  it('top speakers get the reserved unique half, the tail only re-uses the shared 20%', () => {
    const voices: VoiceOption[] = Array.from({ length: 10 }, (_, i) => ({
      locale: 'en-US',
      name: `M${i}Neural`,
      fullValue: `en-US, M${i}Neural`,
      gender: 'male',
    }));
    const chars: LLMCharacter[] = [
      { canonicalName: 'Narrator', variations: [], gender: 'male' },
      ...Array.from({ length: 13 }, (_, i) => ({
        canonicalName: `C${i}`,
        variations: [],
        gender: 'male' as const,
      })),
    ];
    const currentMap = new Map([['Narrator', 'en-US, NarratorNeural']]);

    const result = randomizeBelow(
      chars,
      currentMap,
      -1,
      voices,
      'en-US, NarratorNeural',
      'en',
      freq(chars),
    );

    const top = chars.slice(1, 9).map((c) => result.get(c.canonicalName)!); // 8 unique slots
    const tail = chars.slice(9).map((c) => result.get(c.canonicalName)!); // 5 overflow
    expect(new Set(top).size).toBe(8); // top 8 all distinct
    // Tail voices may repeat but must come from the pool, not the narrator.
    expect(tail.every((v) => v.startsWith('en-US, M'))).toBe(true);
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

    const result = randomizeBelow(
      femaleChar,
      currentMap,
      0,
      onlyMaleVoices,
      'other-voice',
      'en',
      freq(femaleChar),
    );

    // Female Alice gets male voice since no female voices available
    expect(result.get('Alice')).toBe('en-US, GuyNeural');
  });

  it('matches voice gender: females get female voices, males get male, only unknown borrows across', () => {
    const genderedVoices: VoiceOption[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        locale: 'en-US',
        name: `M${i}Neural`,
        fullValue: `en-US, M${i}Neural`,
        gender: 'male' as const,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        locale: 'en-US',
        name: `F${i}Neural`,
        fullValue: `en-US, F${i}Neural`,
        gender: 'female' as const,
      })),
    ];
    const chars: LLMCharacter[] = [
      { canonicalName: 'Narrator', variations: [], gender: 'male' },
      { canonicalName: 'Alice', variations: [], gender: 'female' },
      { canonicalName: 'Bob', variations: [], gender: 'male' },
      { canonicalName: 'Carol', variations: [], gender: 'female' },
      { canonicalName: 'Dan', variations: [], gender: 'male' },
      { canonicalName: 'Group', variations: [], gender: 'unknown' },
    ];
    const currentMap = new Map([['Narrator', 'OTHER']]);

    const result = randomizeBelow(
      chars,
      currentMap,
      -1,
      genderedVoices,
      'OTHER',
      'en',
      freq(chars),
    );

    expect(result.get('Alice')).toContain('F');
    expect(result.get('Carol')).toContain('F');
    expect(result.get('Bob')).toContain('M');
    expect(result.get('Dan')).toContain('M');
    // unknown just gets *some* pool voice, never narrator, never empty
    expect(result.get('Group')).toMatch(/^en-US, [MF]/);
    expect(result.get('Group')).not.toBe('OTHER');
  });

  it('does nothing when clicked on last row', () => {
    const currentMap = new Map([
      ['Narrator', 'en-US, GuyNeural'],
      ['Alice', 'en-US, JennyNeural'],
    ]);

    const result = randomizeBelow(
      characters.slice(0, 2),
      currentMap,
      1, // Last index
      allVoices,
      'other-voice',
      'en',
      new Map<string, number>(),
    );

    expect(result.get('Narrator')).toBe('en-US, GuyNeural');
    expect(result.get('Alice')).toBe('en-US, JennyNeural');
  });
});
