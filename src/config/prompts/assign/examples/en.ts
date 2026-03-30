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
    thinking: `Step 1: Dialogue in 1 (quote), 2 (quote), 3 (bracket message). 0 is narration -> skip.
Step 2: 1 -- "He" refers to John (from paragraph 0). 2 -- "Mary said" -> B. 3 -- bracket -> C.
Step 3: No vocative traps.
Step 4: No ambiguity.
Step 5: Assignments: 1->A, 2->B, 3->C.`,
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
    thinking: `Step 1: Dialogue in 0, 1, 2, 3. All have quotes.
Step 2: 0 -- "the guard shouted" -> B. 1 -- "I asked" -> A (Protagonist). 2 -- "the guard ordered" -> B. 3 -- no explicit tag, but following 2 where guard is speaking -> B continues.
Step 3: "Captain" is inside quotes in paragraph 2 -- vocative trap! Captain is the listener, not speaker.
Step 4: Paragraph 3 follows the guard's order -- guard is still speaking.
Step 5: Assignments: 0->B, 1->A, 2->B, 3->B.`,
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
    thinking: `Step 1: Dialogue in 1, 2, 3, 4. 0 is narration -> skip.
Step 2: 1 -- "I shook my head" -> A (Protagonist). 2 -- "Marcus placed a hand" -> B. 3 -- "Elena sighed" -> C. 4 -- "I said" -> A.
Step 3: No vocative traps.
Step 4: Paragraph 4 follows Elena's speech -- "I said" is explicit tag for Protagonist.
Step 5: Assignments: 1->A, 2->B, 3->C, 4->A.`,
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
    thinking: `Step 1: Dialogue in 2 (quote), 5 (quote). Bracket messages in 1, 4. 0 and 3 are narration -> skip.
Step 2: 1 -- bracket -> B (System). 2 -- "Kira whispered" -> A. 4 -- bracket -> B (System). 5 -- "She drew her blade" -- "She" refers to Kira -> A.
Step 3: No vocative traps.
Step 4: 5 follows narration about skeleton -- "She" is Kira from context.
Step 5: Assignments: 1->B, 2->A, 4->B, 5->A.`,
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
