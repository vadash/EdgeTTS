// src/config/prompts/qa/examples/en.ts
// QA examples showing flawed drafts being corrected

import type { PromptExample } from '../../shared/formatters';

export const qaExamplesEN: PromptExample[] = [
  {
    label: '(EN/VocativeTrapCorrection)',
    input: `[Speaker Codes]:
- A = John [male]
- B = Guard [unknown]

[Numbered Paragraphs]:
[0] "Halt!" the guard shouted.
[1] "What is it?" John asked.
[2] "Show your papers, John," the guard ordered.

[Draft Assignments]:
{
  "reasoning": "0 is Guard. 1 is John asking. 2 is John showing papers.",
  "assignments": {
    "0": "B",
    "1": "A",
    "2": "A"
  }
}`,
    output: `{
  "reasoning": "2: voc trap, John=listener→B (was A).",
  "assignments": {
    "0": "B",
    "1": "A",
    "2": "B"
  }
}`,
  },
  {
    label: '(EN/MissedActionBeat)',
    input: `[Speaker Codes]:
- A = Mary [female]
- B = Protagonist [unknown]

[Numbered Paragraphs]:
[0] "Hello there." Mary smiled.
[1] "Welcome to the shop."

[Draft Assignments]:
{
  "reasoning": "Both quotes are from Mary.",
  "assignments": {
    "0": "A",
    "1": "A"
  }
}`,
    output: `{
  "reasoning": "0: beat 'Mary smiled' after quote→not Mary. Protag spoke→B (was A).",
  "assignments": {
    "0": "B",
    "1": "A"
  }
}`,
  },
  {
    label: '(EN/RemovedNarrationAndAddedMissing)',
    input: `[Speaker Codes]:
- A = Kira [female]
- B = System [female]

[Numbered Paragraphs]:
[0] The dungeon door creaked open.
[1] [Dungeon Entered: Shadow Crypt]
[2] "Finally," Kira whispered.
[3] A skeleton charged toward her.

[Draft Assignments]:
{
  "reasoning": "0 is narration, 1 is System, 2 is Kira, 3 is narration",
  "assignments": {
    "0": "A",
    "1": "B",
    "2": "A"
  }
}`,
    output: `{
  "reasoning": "0: door narr, rm (was A). 1: sys→B ok. 2: Kira→A ok.",
  "assignments": {
    "1": "B",
    "2": "A"
  }
}`,
  },
];
