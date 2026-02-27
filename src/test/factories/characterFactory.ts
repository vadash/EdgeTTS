// Test Factories - Character Data
// Factory functions for creating test LLMCharacter objects

import type { LLMCharacter, SpeakerAssignment } from '@/state/types';

/**
 * Create a test character
 */
export function createTestCharacter(overrides: Partial<LLMCharacter> = {}): LLMCharacter {
  return {
    canonicalName: 'John',
    variations: ['John', 'Johnny', 'Mr. Smith'],
    gender: 'male',
    ...overrides,
  };
}

/**
 * Create multiple test characters
 */
export function createTestCharacters(count: number = 3): LLMCharacter[] {
  const names = [
    { name: 'John', gender: 'male' as const, variations: ['John', 'Johnny'] },
    { name: 'Sarah', gender: 'female' as const, variations: ['Sarah', 'Ms. Jones'] },
    { name: 'Alex', gender: 'unknown' as const, variations: ['Alex'] },
    { name: 'Michael', gender: 'male' as const, variations: ['Michael', 'Mike'] },
    { name: 'Emma', gender: 'female' as const, variations: ['Emma', 'Em'] },
  ];

  return names.slice(0, count).map((n) => ({
    canonicalName: n.name,
    variations: n.variations,
    gender: n.gender,
  }));
}

/**
 * Create a test speaker assignment
 */
export function createTestAssignment(
  overrides: Partial<SpeakerAssignment> = {},
): SpeakerAssignment {
  return {
    sentenceIndex: 0,
    text: 'Hello, world!',
    speaker: 'narrator',
    voiceId: 'en-US-GuyNeural',
    ...overrides,
  };
}

/**
 * Create multiple test speaker assignments
 */
export function createTestAssignments(count: number = 5): SpeakerAssignment[] {
  const samples = [
    { speaker: 'narrator', text: 'The story begins on a dark night.' },
    { speaker: 'John', text: '"I have something to tell you," he said.' },
    { speaker: 'Sarah', text: '"What is it?" she asked.' },
    { speaker: 'narrator', text: 'He paused for a moment.' },
    { speaker: 'John', text: '"Everything is about to change."' },
  ];

  return samples.slice(0, count).map((s, index) => ({
    sentenceIndex: index,
    text: s.text,
    speaker: s.speaker,
    voiceId: s.speaker === 'narrator' ? 'en-US-GuyNeural' : `en-US-${s.speaker}Neural`,
  }));
}

/**
 * Create a voice map from characters
 */
export function createTestVoiceMap(characters: LLMCharacter[]): Map<string, string> {
  const voiceMap = new Map<string, string>();
  const maleVoices = ['en-US-GuyNeural', 'en-US-ChristopherNeural', 'en-US-EricNeural'];
  const femaleVoices = ['en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-MichelleNeural'];

  let maleIndex = 0;
  let femaleIndex = 0;

  for (const char of characters) {
    let voice: string;
    if (char.gender === 'male') {
      voice = maleVoices[maleIndex % maleVoices.length];
      maleIndex++;
    } else if (char.gender === 'female') {
      voice = femaleVoices[femaleIndex % femaleVoices.length];
      femaleIndex++;
    } else {
      voice =
        maleIndex <= femaleIndex
          ? maleVoices[maleIndex++ % maleVoices.length]
          : femaleVoices[femaleIndex++ % femaleVoices.length];
    }

    voiceMap.set(char.canonicalName, voice);
    for (const variation of char.variations) {
      voiceMap.set(variation, voice);
    }
  }

  return voiceMap;
}
