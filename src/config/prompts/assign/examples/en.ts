// src/config/prompts/assign/examples/en.ts
// 5 few-shot examples for speaker attribution -- EN language
// Progresses: simple assignment -> vocative trap -> first person + context -> system messages + mixed -> dialogue with long narration tail

import type { PromptExample } from '../../shared/formatters';

export const assignExamplesEN: PromptExample[] = [
  {
    label: '(EN/Simple)',
    input: `[Speaker Codes]:
- A3F1 = John [male]
- B2C4 = Mary [female]
- C9D2 = System [female]

[Numbered Paragraphs]:
[0] John walked into the room.
[1] He looked around. "Where is everyone?"
[2] "I'm right here," Mary said.
[3] [Quest Updated]`,
    output: `{
  "reasoning": "0: narr. 1: John→A3F1. 2: Mary→B2C4. 3: sys→C9D2.",
  "assignments": {
    "1": "A3F1",
    "2": "B2C4",
    "3": "C9D2"
  }
}`,
  },
  {
    label: '(EN/VocativeTrap)',
    input: `[Speaker Codes]:
- F7E3 = Protagonist [male]
- D1A5 = Guard [unknown]
- E8B9 = Captain [male]

[Numbered Paragraphs]:
[0] "Halt!" the guard shouted.
[1] "What is it?" I asked.
[2] "Show your papers, Captain," the guard ordered.
[3] "Of course."`,
    output: `{
  "reasoning": "0: guard→D1A5. 1: 'I'→F7E3. 2: guard→D1A5, Captain voc. 3: guard cont→D1A5.",
  "assignments": {
    "0": "D1A5",
    "1": "F7E3",
    "2": "D1A5",
    "3": "D1A5"
  }
}`,
  },
  {
    label: '(EN/FirstPersonContext)',
    input: `[Speaker Codes]:
- 5C2A = Protagonist [female]
- 7F4D = Marcus [male]
- 3E8B = Elena [female]

[Numbered Paragraphs]:
[0] I stared at the notification.
[1] "This can't be right." I shook my head.
[2] Marcus placed a hand on my shoulder. "It is."
[3] Elena sighed. "We need to tell the others."
[4] "Agreed," I said.`,
    output: `{
  "reasoning": "1: 'I'→5C2A. 2: Marcus beat→7F4D. 3: Elena beat→3E8B. 4: 'I said'→5C2A.",
  "assignments": {
    "1": "5C2A",
    "2": "7F4D",
    "3": "3E8B",
    "4": "5C2A"
  }
}`,
  },
  {
    label: '(EN/SystemAndMixed)',
    input: `[Speaker Codes]:
- 9A1F = Kira [female]
- 4B6C = System [female]

[Numbered Paragraphs]:
[0] The dungeon door creaked open.
[1] [Dungeon Entered: Shadow Crypt -- Level 3]
[2] "Finally," Kira whispered.
[3] A skeleton charged toward her.
[4] [Warning: Enemy Level 15 -- Retreat Recommended]
[5] "Not today." She drew her blade.`,
    output: `{
  "reasoning": "1: sys→4B6C. 2: Kira tag→9A1F. 3: narr. 4: sys→4B6C. 5: 'She'=Kira beat→9A1F.",
  "assignments": {
    "1": "4B6C",
    "2": "9A1F",
    "4": "4B6C",
    "5": "9A1F"
  }
}`,
  },
  {
    label: '(EN/DialogueWithLongNarration)',
    input: `[Speaker Codes]:
- 6D3E = Professor Viridian [male]
- 2A9F = Mirian [female]

[Numbered Paragraphs]:
[0] "Observe," Professor Viridian said. He put on a heavy steel gauntlet plated with glowing runes, which looked ridiculous on his thin boney frame. He then reached through the magic barrier and plucked a single leaf.
[1] The plant erupted in golden light.
[2] "Observe, the golden crown," the professor said, "hence regal cordyline. Wear proper protective gear, or you're likely to lose your arm."
[3] Mirian could feel the heat even from the second row. The golden light spun in a circle, crackling with energy.`,
    output: `{
  "reasoning": "0: Viridian tag→6D3E. 1: narr. 2: professor=Viridian tag→6D3E. 3: narr.",
  "assignments": {
    "0": "6D3E",
    "2": "6D3E"
  }
}`,
  },
];
