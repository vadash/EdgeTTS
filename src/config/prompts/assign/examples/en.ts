// src/config/prompts/assign/examples/en.ts
// 5 few-shot examples for speaker attribution -- EN language
// Progresses: simple assignment -> vocative trap -> first person + context -> system messages + mixed -> dialogue with long narration tail

import type { PromptExample } from '../../shared/formatters';

export const assignExamplesEN: PromptExample[] = [
  {
    label: '(EN/Simple)',
    input: `[Speaker Codes]:
- A = John [male]
- B = Mary [female]
- C = System [female]

[Numbered Paragraphs]:
[0] John walked into the room.
[1] He looked around. "Where is everyone?"
[2] "I'm right here," Mary said.
[3] [Quest Updated]`,
    output: `{
  "reasoning": "0: narr. 1: John→A. 2: Mary→B. 3: sys→C.",
  "assignments": {
    "1": "A",
    "2": "B",
    "3": "C"
  }
}`,
  },
  {
    label: '(EN/VocativeTrap)',
    input: `[Speaker Codes]:
- A = Protagonist [male]
- B = Guard [unknown]
- C = Captain [male]

[Numbered Paragraphs]:
[0] "Halt!" the guard shouted.
[1] "What is it?" I asked.
[2] "Show your papers, Captain," the guard ordered.
[3] "Of course."`,
    output: `{
  "reasoning": "0: guard→B. 1: 'I'→A. 2: guard→B, Captain voc. 3: guard cont→B.",
  "assignments": {
    "0": "B",
    "1": "A",
    "2": "B",
    "3": "B"
  }
}`,
  },
  {
    label: '(EN/FirstPersonContext)',
    input: `[Speaker Codes]:
- A = Protagonist [female]
- B = Marcus [male]
- C = Elena [female]

[Numbered Paragraphs]:
[0] I stared at the notification.
[1] "This can't be right." I shook my head.
[2] Marcus placed a hand on my shoulder. "It is."
[3] Elena sighed. "We need to tell the others."
[4] "Agreed," I said.`,
    output: `{
  "reasoning": "1: 'I'→A. 2: Marcus beat→B. 3: Elena beat→C. 4: 'I said'→A.",
  "assignments": {
    "1": "A",
    "2": "B",
    "3": "C",
    "4": "A"
  }
}`,
  },
  {
    label: '(EN/SystemAndMixed)',
    input: `[Speaker Codes]:
- A = Kira [female]
- B = System [female]

[Numbered Paragraphs]:
[0] The dungeon door creaked open.
[1] [Dungeon Entered: Shadow Crypt -- Level 3]
[2] "Finally," Kira whispered.
[3] A skeleton charged toward her.
[4] [Warning: Enemy Level 15 -- Retreat Recommended]
[5] "Not today." She drew her blade.`,
    output: `{
  "reasoning": "1: sys→B. 2: Kira tag→A. 3: narr. 4: sys→B. 5: 'She'=Kira beat→A.",
  "assignments": {
    "1": "B",
    "2": "A",
    "4": "B",
    "5": "A"
  }
}`,
  },
  {
    label: '(EN/DialogueWithLongNarration)',
    input: `[Speaker Codes]:
- A = Professor Viridian [male]
- B = Mirian [female]

[Numbered Paragraphs]:
[0] "Observe," Professor Viridian said. He put on a heavy steel gauntlet plated with glowing runes, which looked ridiculous on his thin boney frame. He then reached through the magic barrier and plucked a single leaf.
[1] The plant erupted in golden light.
[2] "Observe, the golden crown," the professor said, "hence regal cordyline. Wear proper protective gear, or you're likely to lose your arm."
[3] Mirian could feel the heat even from the second row. The golden light spun in a circle, crackling with energy.`,
    output: `{
  "reasoning": "0: Viridian tag→A. 1: narr. 2: professor=Viridian tag→A. 3: narr.",
  "assignments": {
    "0": "A",
    "2": "A"
  }
}`,
  },
];
