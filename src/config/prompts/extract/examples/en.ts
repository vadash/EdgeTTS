// 4 few-shot examples for character extraction -- EN language, SFW content
// Progresses: simple dialogue -> system messages -> vocative trap -> gender inference + variations

import type { PromptExample } from '../../shared/formatters';

export const extractExamplesEN: PromptExample[] = [
  {
    label: '(EN/Simple)',
    input: `John smiled. "Good morning, Mary!"
"Morning," she replied.`,
    output: `{
  "reasoning": "John speaks first with an action beat. Mary replies with 'she replied.' Mary's name in the first quote is vocative -- she is the listener, not speaker.",
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
  "reasoning": "The guard shouts a warning. The narrator (I) replies. The Captain is spoken to, but doesn't speak. [Level Up!] is a system message.",
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
  "reasoning": "Mary speaks in quotes 1 and 3 (explicit tags). John speaks in quotes 2 and 4 (tag + action beat). 'John' inside Mary's first quote is vocative -- he is the listener. Marcus is only mentioned as vocative in quote 3 and never speaks -- do NOT extract.",
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
  "reasoning": "The wizard speaks twice (action beat + 'the wizard said'). Galdor speaks once ('cried Galdor'). System sends a bracket message. 'He' in Galdor's quote refers to the wizard, not a vocative. Wizard uses 'his' -> male. System -> female.",
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
