// src/config/prompts/assign/examples/en.ts
// 4 few-shot examples for speaker attribution -- EN language
// Progresses: simple assignment -> vocative trap -> first person + context -> system messages + mixed

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
  "reasoning": "0 is narration. 1 has John speaking. 2 has Mary speaking. 3 is a System message.",
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
  "reasoning": "0 is the guard. 1 is the protagonist ('I'). 2 is the guard speaking to Captain (vocative -- Captain is listener). 3 is the guard continuing.",
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
  "reasoning": "1 is Protagonist ('I shook my head'). 2 is Marcus (action beat). 3 is Elena (action beat). 4 is Protagonist ('I said').",
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
  "reasoning": "1 is a system message. 2 is Kira (explicit tag). 3 is narration. 4 is a system message. 5 is Kira (action beat, 'She' refers to Kira).",
  "assignments": {
    "1": "B",
    "2": "A",
    "4": "B",
    "5": "A"
  }
}`,
  },
];
