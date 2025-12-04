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
    name: 'English Dorm Scene',
    file: 'sample-story-en.txt',
    expectedCharacters: [
      { name: 'Mirian', gender: 'female' },
      { name: 'Lily', gender: 'female' },
    ],
    expectedDialogueLines: [
      { textContains: 'Are you okay?', speaker: 'Lily', strict: true },
      { textContains: 'nightmare or something', speaker: 'Mirian', strict: true },
      { textContains: 'Lily said, eyes actually open', speaker: 'Lily', strict: true },  // "What's up?" line
      { textContains: 'Mirian said', speaker: 'Mirian', strict: true },  // "There's a hole" line
      { textContains: 'Oh, great', speaker: 'Lily', strict: true },
      { textContains: 'No idea', speaker: 'Mirian', strict: true },
      { textContains: 'enchantments exam', speaker: 'Lily', strict: true },
      { textContains: 'put her head in her hands', speaker: 'narrator', strict: true },
    ],
  },
  {
    name: 'Russian Brothers Dialogue',
    file: 'sample-story-ru.txt',
    expectedCharacters: [
      { name: 'Мартин', gender: 'male' },
      { name: 'Женька', gender: 'male' },  // proper name preferred over "брат"
    ],
    expectedDialogueLines: [
      { textContains: 'чем ты сейчас занимаешься', speaker: 'Женька', strict: true },
      { textContains: 'Всякой фигней', speaker: 'Мартин', strict: true },
      { textContains: 'Ты ведешь какое-то серьезное', speaker: 'Женька', strict: true },
      { textContains: 'Заканчиваю', speaker: 'Мартин', strict: true },
      { textContains: 'А что осталось', speaker: 'Женька', strict: true },
      { textContains: 'Девочка кое-что', speaker: 'Мартин', strict: true },
      { textContains: 'Меня расспрашивали', speaker: 'Женька', strict: true },
      { textContains: 'Мент?', speaker: 'Мартин', strict: true },
      { textContains: 'Госбезопасность', speaker: 'Женька', strict: true },
      { textContains: 'Да что им от меня надо', speaker: 'Мартин', strict: true },
      { textContains: 'Вот уж не знаю', speaker: 'Женька', strict: true },
    ],
  },
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
