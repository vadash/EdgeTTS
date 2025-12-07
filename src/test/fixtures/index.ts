import type { LLMCharacter } from "@/state/types";

/**
 * Test fixture definitions for LLM prompt tuning
 */

export interface ExpectedCharacter {
  name: string; // partial match (case-insensitive)
  gender: "male" | "female" | "unknown";
}

export interface ExpectedDialogue {
  textContains: string; // sentence must contain this text
  speaker: string; // expected speaker name - matches canonicalName or any variation (case-insensitive)
  strict?: boolean; // if true, fail test on mismatch; if false, just log warning
}

export interface TestFixture {
  name: string;
  file: string; // relative to fixtures/ directory
  expectedCharacters: ExpectedCharacter[];
  expectedDialogueLines: ExpectedDialogue[];
}

/**
 * Test fixtures - add new test cases here
 */
export const fixtures: TestFixture[] = [
  {
    name: "Sample 1 - Vinland Majesty",
    file: "sample1.txt",
    expectedCharacters: [
      { name: "Fielding", gender: "male" },
      { name: "Tennyson", gender: "male" },
    ],
    expectedDialogueLines: [
      { textContains: "Alan, I'm so sorry", speaker: "Tennyson", strict: false },
      { textContains: "I'll get them", speaker: "Fielding", strict: false },
      { textContains: "Leave it to the authorities", speaker: "Tennyson", strict: false },
      { textContains: "There are no bloody authorities", speaker: "Fielding", strict: false },
      { textContains: "It could still be some kind of private estate", speaker: "Tennyson", strict: false },
      { textContains: "On the coast", speaker: "Fielding", strict: false },
      { textContains: "Willard thinks we've gone back in time", speaker: "Fielding", strict: false },
      { textContains: "We can put the hows and whys", speaker: "Tennyson", strict: false },
      { textContains: "I'll be there", speaker: "Fielding", strict: false },
      { textContains: "Sure", speaker: "Conrad", strict: false },
      { textContains: "Make sure those two are at the meeting", speaker: "Tennyson", strict: false },
      { textContains: "Do they have any experience", speaker: "Fielding", strict: false },
      { textContains: "Alan, I know how you feel", speaker: "Tennyson", strict: false },
      { textContains: "No you bloody don't", speaker: "Fielding", strict: false },
      { textContains: "I don't intend to leave it up to chance", speaker: "Fielding", strict: false },
      { textContains: "I can't condone murder", speaker: "Tennyson", strict: false },
      { textContains: "I'm going, Dave", speaker: "Fielding", strict: false },
      { textContains: "If necessary", speaker: "Tennyson", strict: false },
      { textContains: "I don't intend to find out", speaker: "Fielding", strict: false },
      { textContains: "And we bring them back alive", speaker: "Tennyson", strict: false },
      { textContains: "That's down to them", speaker: "Fielding", strict: false },
      { textContains: "go get some rest", speaker: "Tennyson", strict: false },
    ],
  },
  {
    name: "Sample 2 - Russian Dialogue",
    file: "sample2.txt",
    expectedCharacters: [
      { name: "Мартин", gender: "male" },
      { name: "Женька", gender: "male" },
    ],
    expectedDialogueLines: [
      { textContains: "Март, чем ты сейчас занимаешься", speaker: "Женька", strict: false },
      { textContains: "Всякой фигней", speaker: "Мартин", strict: false },
      { textContains: "Ты ведешь какое-то серьезное дело", speaker: "Женька", strict: false },
      { textContains: "Заканчиваю", speaker: "Мартин", strict: false },
      { textContains: "А что осталось не законченным", speaker: "Женька", strict: false },
      { textContains: "Девочка кое-что успела мне сообщить", speaker: "Мартин", strict: false },
      { textContains: "Меня расспрашивали о тебе", speaker: "Женька", strict: false },
      { textContains: "Мент", speaker: "Мартин", strict: false },
      { textContains: "Госбезопасность", speaker: "Женька", strict: false },
      { textContains: "Да что им от меня надо", speaker: "Мартин", strict: false },
      { textContains: "Вот уж не знаю", speaker: "Женька", strict: false },
    ],
  },
  {
    name: "Sample 3 - Mirian and Lily",
    file: "sample3.txt",
    expectedCharacters: [
      { name: "Mirian", gender: "female" },
      { name: "Lily", gender: "female" },
    ],
    expectedDialogueLines: [
      { textContains: "Mirian? Are you okay", speaker: "Lily", strict: false },
      { textContains: "nightmare or something", speaker: "Mirian", strict: false },
      { textContains: "What’s up", speaker: "Lily", strict: false },
      { textContains: "There’s a hole", speaker: "Mirian", strict: false },
      { textContains: "Oh, great", speaker: "Lily", strict: false },
      { textContains: "No idea", speaker: "Mirian", strict: false },
      { textContains: "Don’t you have an enchantments exam", speaker: "Lily", strict: false },
      { textContains: "Yes", speaker: "Mirian", strict: false },
    ],
  },
];

/**
 * Helper to find a character by name (case-insensitive partial match)
 * Checks both canonicalName and all variations
 */
export function findCharacter(
  characters: LLMCharacter[],
  name: string
): LLMCharacter | undefined {
  const lowerName = name.toLowerCase();
  return characters.find(
    (c) =>
      c.canonicalName.toLowerCase().includes(lowerName) ||
      c.variations.some((v) => v.toLowerCase().includes(lowerName))
  );
}

/**
 * Helper to check if a character exists in the list
 */
export function hasCharacter(
  characters: LLMCharacter[],
  name: string
): boolean {
  return findCharacter(characters, name) !== undefined;
}

/**
 * Check if a speaker name matches a character (by canonicalName or any variation)
 * Returns true if the speaker matches the expected name considering all aliases
 */
export function speakerMatchesCharacter(
  speaker: string,
  expectedName: string,
  characters: LLMCharacter[]
): boolean {
  const speakerLower = speaker.toLowerCase();
  const expectedLower = expectedName.toLowerCase();

  // Direct match (narrator or simple case)
  if (
    speakerLower === expectedLower ||
    speakerLower.includes(expectedLower) ||
    expectedLower.includes(speakerLower)
  ) {
    return true;
  }

  // Find the character that expectedName refers to
  const expectedChar = findCharacter(characters, expectedName);
  if (!expectedChar) {
    return false;
  }

  // Check if speaker matches any of the character's names
  const allNames = [expectedChar.canonicalName, ...expectedChar.variations];
  return allNames.some((name) => {
    const nameLower = name.toLowerCase();
    return (
      speakerLower === nameLower ||
      speakerLower.includes(nameLower) ||
      nameLower.includes(speakerLower)
    );
  });
}

/**
 * Find which character a speaker refers to (resolves aliases to canonical character)
 */
export function resolveCharacterFromSpeaker(
  speaker: string,
  characters: LLMCharacter[]
): LLMCharacter | undefined {
  const speakerLower = speaker.toLowerCase();

  return characters.find((c) => {
    const allNames = [c.canonicalName, ...c.variations];
    return allNames.some((name) => {
      const nameLower = name.toLowerCase();
      return (
        speakerLower === nameLower ||
        speakerLower.includes(nameLower) ||
        nameLower.includes(speakerLower)
      );
    });
  });
}
