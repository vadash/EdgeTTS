// 4 few-shot examples for character extraction -- EN language, SFW content
// Progresses: simple dialogue -> system messages -> vocative trap -> gender inference + variations

import type { PromptExample } from '../../shared/formatters';

export const extractExamplesEN: PromptExample[] = [
  {
    label: '(EN/Simple)',
    input: `John smiled. "Good morning, Mary!"
"Morning," she replied.`,
    output: `{
  "reasoning": "John(beat). Mary('she replied'). Mary voc-listener.",
  "characters": [
    {
      "canonicalName": "John",
      "variations": ["John"],
      "gender": "male"
    },
    {
      "canonicalName": "Mary",
      "variations": ["Mary"],
      "gender": "female"
    }
  ]
}`,
  },
  {
    label: '(EN/SystemAndFirstPerson)',
    input: `"Watch out, Captain!" shouted the guard.
I grabbed my sword. "Thanks."
[Level Up! You have reached Level 5.]`,
    output: `{
  "reasoning": "Guard(shout). Protag('I'). Captain voc-only. System(bracket).",
  "characters": [
    {
      "canonicalName": "Guard",
      "variations": ["Guard", "the guard"],
      "gender": "unknown"
    },
    {
      "canonicalName": "Protagonist",
      "variations": ["Protagonist"],
      "gender": "unknown"
    },
    {
      "canonicalName": "System",
      "variations": ["System"],
      "gender": "female"
    }
  ]
}`,
  },
  {
    label: '(EN/VocativeTrap)',
    input: `"John, come here!" said Mary.
"Right away," John replied.
"Have you seen Marcus?" Mary asked.
John shook his head. "No, not since yesterday."`,
    output: `{
  "reasoning": "Mary(tag q1,q3). John(tag q2, beat q4). John voc-q1. Marcus voc-only, skip.",
  "characters": [
    {
      "canonicalName": "Mary",
      "variations": ["Mary"],
      "gender": "female"
    },
    {
      "canonicalName": "John",
      "variations": ["John"],
      "gender": "male"
    }
  ]
}`,
  },
  {
    label: '(EN/GenderAndVariations)',
    input: `The old wizard raised his staff. "You shall not pass!"
"No!" cried Galdor. "He's too strong!"
"Don't worry," the wizard said calmly. "I have faced worse."
[Warning: Dark Magic Detected!]`,
    output: `{
  "reasoning": "Wizard(beat+tag, 2x, his→M). Galdor(cried). System(bracket→F). 'He'=wizard, not voc.",
  "characters": [
    {
      "canonicalName": "Wizard",
      "variations": ["Wizard", "the wizard", "the old wizard"],
      "gender": "male"
    },
    {
      "canonicalName": "Galdor",
      "variations": ["Galdor"],
      "gender": "unknown"
    },
    {
      "canonicalName": "System",
      "variations": ["System"],
      "gender": "female"
    }
  ]
}`,
  },
];
