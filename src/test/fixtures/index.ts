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
  // {
  //   name: "sample_1_en_simple",
  //   file: "sample_1_en_simple.txt",
  //   expectedCharacters: [
  //     { name: "Mirian", gender: "female" },
  //     { name: "Lily", gender: "female" },
  //   ],
  //   expectedDialogueLines: [
  //     { textContains: "Mirian? Are you okay", speaker: "Lily", strict: false },
  //     { textContains: "nightmare or something", speaker: "Mirian", strict: false },
  //     { textContains: "What's up", speaker: "Lily", strict: false },
  //     { textContains: "There's a hole", speaker: "Mirian", strict: false },
  //     { textContains: "Oh, great", speaker: "Lily", strict: false },
  //     { textContains: "No idea", speaker: "Mirian", strict: false },
  //     { textContains: "Don't you have an enchantments exam", speaker: "Lily", strict: false },
  //     { textContains: "Yes", speaker: "Mirian", strict: false },
  //   ],
  // },
  // {
  //   name: "sample_2_ru_hard",
  //   file: "sample_2_ru_hard.txt",
  //   expectedCharacters: [
  //     // Main characters
  //     { name: "Алексей", gender: "male" },
  //     { name: "Маркус", gender: "male" },
  //     { name: "Елена", gender: "female" },
  //     { name: "Мистия", gender: "female" },
  //     { name: "Гром", gender: "male" },
  //     { name: "Лириэль", gender: "female" },
  //     // System/Interface (extracted as "System" per prompt rule: "System" is always in English)
  //     { name: "System", gender: "female" },
  //     { name: "Внутренний голос", gender: "unknown" },
  //   ],
  //   expectedDialogueLines: [
  //     // Opening - Marcus speaking to Alexei
  //     { textContains: "Вставай, ленивец", speaker: "Маркус", strict: true },
  //     { textContains: "Кто ты?", speaker: "Алексей", strict: true },
  //     { textContains: "Меня зовут Маркус", speaker: "Маркус", strict: true },
  //     { textContains: "Маркус...", speaker: "Алексей", strict: true },
  //     { textContains: "А где я вообще?", speaker: "Алексей", strict: true },
  //     { textContains: "В Терре, мир вечных битв", speaker: "Марк", strict: true },
  //     { textContains: "Это какой-то тест?", speaker: "Алексей", strict: true },
  //     { textContains: "Это новая реальность", speaker: "Маркус", strict: true },

  //     // System messages (extracted as "System" per prompt rule)
  //     { textContains: "[Загрузка сознания", speaker: "System", strict: true },
  //     { textContains: "[Новая квестовая линия", speaker: "System", strict: true },

  //     // Meeting Elena
  //     { textContains: "Эй, Марк!", speaker: "Елена", strict: true },
  //     { textContains: "Познакомься, Алексей. Это Елена", speaker: "Марк", strict: true },
  //     { textContains: "Привет", speaker: "Алексей", strict: true },
  //     { textContains: "Он живой?", speaker: "Елена", strict: true },
  //     { textContains: "Выживет", speaker: "Мистия", strict: true }, // Spoken from behind, now explicitly Mistia

  //     // Meeting Mistia
  //     { textContains: "Я Мистия", speaker: "Мистия", strict: true },
  //     { textContains: "Остроумный. Нравится", speaker: "Мистия", strict: true },
  //     { textContains: "Что дальше?", speaker: "Алексей", strict: true },

  //     // Training scene
  //     { textContains: "Тренировка", speaker: "Марк", strict: true },
  //     { textContains: "Я не умею", speaker: "Алексей", strict: true },
  //     { textContains: "Научишься", speaker: "Елена", strict: true }, // "Elena" (Latin letters) used
  //     { textContains: "Какой меч?", speaker: "Алексей", strict: true },
  //     { textContains: "Возьми полегче", speaker: "Мистия", strict: true },

  //     // Evening scene
  //     { textContains: "Прогресс", speaker: "Марк", strict: true },
  //     { textContains: "Отдыхай", speaker: "Елена", strict: true },
  //     { textContains: "Спасибо за оптимизм", speaker: "Алексей", strict: true },

  //     // Grom vs Liriél conflict
  //     { textContains: "Это моя добыча!", speaker: "Гром", strict: true },
  //     // Skipping "Нашла я её первую!" due to em-dash parsing issues
  //     { textContains: "Попробуй, урод!", speaker: "Лириэль", strict: true },

  //     // Alexei intervenes
  //     { textContains: "Эй, — сказал я. — Может, разделите поровну?", speaker: "Алексей", strict: true },
  //     { textContains: "Кто это такой?", speaker: "Гром", strict: true }, // Vocative - Alexei is being addressed, not speaking
  //     { textContains: "Новенький", speaker: "Лириэль", strict: true },
  //     { textContains: "Я сказал", speaker: "Алексей", strict: true },
  //     { textContains: "Он тебя боится", speaker: "Лириэль", strict: true },
  //     { textContains: "Не боюсь!", speaker: "Гром", strict: true },

  //     // Aftermath
  //     { textContains: "Недурно для первого дня", speaker: "Марк", strict: true },
  //     { textContains: "Ты сумасшедший", speaker: "Елена", strict: true },
  //     { textContains: "Риск — дело благородное", speaker: "Алексей", strict: true },
  //     { textContains: "Или глупого", speaker: "Елена", strict: true },
  //     { textContains: "Пора спать", speaker: "Мистия", strict: true },

  //     // Telepathic inner voice
  //     { textContains: "Кто здесь?", speaker: "Алексей", strict: true },
  //     { textContains: "Я — Твой внутренний голос", speaker: "Внутренний голос", strict: true },
  //     { textContains: "Шикарно", speaker: "Алексей", strict: true },
  //   ],
  // },
  {
    name: "sample_3_en_royalroad",
    file: "sample_3_en_royalroad.txt",
    expectedCharacters: [
      { name: "Mirian", gender: "female" },
      { name: "Nicolus", gender: "male" },
      { name: "Professor Seneca", gender: "female" },
      { name: "Professor Viridian", gender: "male" },
      { name: "Valen", gender: "female" },
    ],
    expectedDialogueLines: [
      // Mirian to guard (guard responses skipped)
      { textContains: "Hi, sorry to bother you", speaker: "Mirian", strict: false },
      { textContains: "It's just", speaker: "Mirian", strict: false },
      { textContains: "I just thought you might want to know", speaker: "Mirian", strict: false },

      // Professor Seneca's class
      { textContains: "Alright, class", speaker: "Professor Seneca", strict: false },
      { textContains: "Remember, we started our class", speaker: "Professor Seneca", strict: false },
      { textContains: "It will be now", speaker: "Professor Seneca", strict: false },
      { textContains: "Alchemical mana is classified in three ways", speaker: "Professor Seneca", strict: false },
      { textContains: "Next, mana is classified", speaker: "Professor Seneca", strict: false },

      // Nicolus interactions
      { textContains: "Damn", speaker: "Nicolus", strict: false },
      { textContains: "Hey. Want to study together", speaker: "Nicolus", strict: false },
      { textContains: "Sure", speaker: "Mirian", strict: false },
      { textContains: "Great", speaker: "Nicolus", strict: false },

      // Professor Viridian's class
      { textContains: "Regal cordyline, ruby variety", speaker: "Professor Viridian", strict: false },
      { textContains: "Glycomyriate", speaker: "Valen", strict: false },
      { textContains: "Very volatile when their mana flow is destabilized", speaker: "Valen", strict: false },
      { textContains: "Observe", speaker: "Professor Viridian", strict: false },
      { textContains: "Observe, the golden crown", speaker: "Professor Viridian", strict: false },

      // Mirian and Valen interaction at the end
      { textContains: "Did you see that", speaker: "Mirian", strict: false },
      { textContains: "Sorry", speaker: "Mirian", strict: false },
      { textContains: "Yeah", speaker: "Valen", strict: false },
      { textContains: "Isn't that corridor forbidden", speaker: "Valen", strict: false },
      { textContains: "We should tell Professor Viridian", speaker: "Mirian", strict: false },
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
