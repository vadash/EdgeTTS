import { describe, it, expect } from 'vitest';
import { exportToProfile, importProfile, isCharacterVisible } from './VoiceProfile';
import type { VoiceProfileFile, LLMCharacter, SpeakerAssignment } from '@/state/types';

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
