import type { LLMCharacter } from '@/state/types';

/**
 * Test fixture definitions for LLM prompt tuning
 */

export interface ExpectedCharacter {
  name: string;       // partial match (case-insensitive)
  gender: 'male' | 'female' | 'unknown';
}

export interface ExpectedDialogue {
  textContains: string;  // sentence must contain this text
  speaker: string;       // expected speaker name (partial match, case-insensitive)
  strict?: boolean;      // if true, fail test on mismatch; if false, just log warning
}

export interface TestFixture {
  name: string;
  file: string;  // relative to fixtures/ directory
  expectedCharacters: ExpectedCharacter[];
  expectedDialogueLines: ExpectedDialogue[];
}

/**
 * Test fixtures - add new test cases here
 */
export const fixtures: TestFixture[] = [
  {
    name: 'English Story - Mirian & Lily',
    file: 'sample-story-en.txt',
    expectedCharacters: [
      { name: 'mirian', gender: 'female' },
      { name: 'lily', gender: 'female' },
    ],
    expectedDialogueLines: [
      { textContains: 'Are you okay', speaker: 'lily', strict: false },
      { textContains: 'nightmare or something', speaker: 'mirian', strict: false },
      { textContains: 'There\'s a hole', speaker: 'mirian', strict: false },
      { textContains: 'It\'s leaking', speaker: 'mirian', strict: false },
      { textContains: 'first floor', speaker: 'lily', strict: false },
      { textContains: 'How the hell', speaker: 'lily', strict: false },
      { textContains: 'No idea', speaker: 'mirian', strict: false },
      { textContains: 'enchantments exam', speaker: 'lily', strict: false },
      { textContains: 'You\'re the best', speaker: 'mirian', strict: false },
      { textContains: 'this one\'s free', speaker: 'lily', strict: false },
    ],
  },
  // Add more fixtures here as needed
];

/**
 * Helper to find a character by name (case-insensitive partial match)
 */
export function findCharacter(characters: LLMCharacter[], name: string): LLMCharacter | undefined {
  const lowerName = name.toLowerCase();
  return characters.find(c => c.canonicalName.toLowerCase().includes(lowerName));
}

/**
 * Helper to check if a character exists in the list
 */
export function hasCharacter(characters: LLMCharacter[], name: string): boolean {
  return findCharacter(characters, name) !== undefined;
}
