// src/config/prompts/qa/examples/en.ts
// QA examples showing flawed drafts being corrected

import type { PromptExample } from '../../shared/formatters';

export const qaExamplesEN: PromptExample[] = [
  {
    label: '(EN/VocativeTrapCorrection)',
    input: `[Speaker Codes]:
- A3F1 = John [male]
- B2C4 = Guard [unknown]

[Numbered Paragraphs]:
[0] "Halt!" the guard shouted.
[1] "What is it?" John asked.
[2] "Show your papers, John," the guard ordered.

[Draft Assignments]:
{
  "reasoning": "0 is Guard. 1 is John asking. 2 is John showing papers.",
  "assignments": {
    "0": "B2C4",
    "1": "A3F1",
    "2": "A3F1"
  }
}`,
    output: `{
  "reasoning": "2: voc trap, John=listener→B2C4 (was A3F1).",
  "assignments": {
    "0": "B2C4",
    "1": "A3F1",
    "2": "B2C4"
  }
}`,
  },
  {
    label: '(EN/MissedActionBeat)',
    input: `[Speaker Codes]:
- C7D2 = Mary [female]
- E5F8 = Protagonist [unknown]

[Numbered Paragraphs]:
[0] "Hello there." Mary smiled.
[1] "Welcome to the shop."

[Draft Assignments]:
{
  "reasoning": "Both quotes are from Mary.",
  "assignments": {
    "0": "C7D2",
    "1": "C7D2"
  }
}`,
    output: `{
  "reasoning": "0: beat 'Mary smiled' after quote→not Mary. Protag spoke→E5F8 (was C7D2).",
  "assignments": {
    "0": "E5F8",
    "1": "C7D2"
  }
}`,
  },
  {
    label: '(EN/RemovedNarrationAndAddedMissing)',
    input: `[Speaker Codes]:
- 1B4A = Kira [female]
- 8F3C = System [female]

[Numbered Paragraphs]:
[0] The dungeon door creaked open.
[1] [Dungeon Entered: Shadow Crypt]
[2] "Finally," Kira whispered.
[3] A skeleton charged toward her.

[Draft Assignments]:
{
  "reasoning": "0 is narration, 1 is System, 2 is Kira, 3 is narration",
  "assignments": {
    "0": "1B4A",
    "1": "8F3C",
    "2": "1B4A"
  }
}`,
    output: `{
  "reasoning": "0: door narr, rm (was 1B4A). 1: sys→8F3C ok. 2: Kira→1B4A ok.",
  "assignments": {
    "1": "8F3C",
    "2": "1B4A"
  }
}`,
  },
];
