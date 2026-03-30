// src/config/prompts/merge/examples/en.ts
// 4 few-shot examples for character merge/deduplication -- EN language
// Progresses: shared variation -> system linking -> no merges -> protagonist + ordering

import type { PromptExample } from '../../shared/formatters';

export const mergeExamplesEN: PromptExample[] = [
  {
    label: '(EN/SharedVariation)',
    input: `0. canonicalName: "System", variations: ["System"], gender: "female"
1. canonicalName: "Interface", variations: ["Interface"], gender: "female"
2. canonicalName: "Alex", variations: ["Alex"], gender: "male"
3. canonicalName: "Alexander Gray", variations: ["Alexander Gray", "Alex"], gender: "male"
4. canonicalName: "Elena", variations: ["Elena"], gender: "female"`,
    output: `{
  "reasoning": "0 and 1 are game systems. 2 and 3 share the variation 'Alex' and are male. 4 is unique.",
  "merges": [
    [0, 1],
    [3, 2]
  ]
}`,
  },
  {
    label: '(EN/SystemLinking)',
    input: `0. canonicalName: "Blue Box", variations: ["Blue Box"], gender: "female"
1. canonicalName: "Notification", variations: ["Notification"], gender: "female"
2. canonicalName: "Kira", variations: ["Kira"], gender: "female"
3. canonicalName: "System", variations: ["System"], gender: "female"
4. canonicalName: "Quest", variations: ["Quest"], gender: "female"`,
    output: `{
  "reasoning": "Blue Box, Notification, System, and Quest are all game system entities. Merge them with System as the best name.",
  "merges": [
    [3, 0, 1, 4]
  ]
}`,
  },
  {
    label: '(EN/NoMerges)',
    input: `0. canonicalName: "The Guard", variations: ["The Guard"], gender: "unknown"
1. canonicalName: "Mary", variations: ["Mary"], gender: "female"
2. canonicalName: "John", variations: ["John"], gender: "male"`,
    output: `{
  "reasoning": "No characters share names or roles.",
  "merges": []
}`,
  },
  {
    label: '(EN/ProtagonistOrdering)',
    input: `0. canonicalName: "Protagonist", variations: ["Protagonist"], gender: "male"
1. canonicalName: "Marcus Chen", variations: ["Marcus Chen", "Marcus", "Marc"], gender: "male"
2. canonicalName: "Lyra", variations: ["Lyra"], gender: "female"
3. canonicalName: "Elena", variations: ["Elena", "Len"], gender: "female"`,
    output: `{
  "reasoning": "Protagonist and Marcus Chen are likely the same person (male, main character). Marcus Chen is the better name. Elena and Lyra are different people.",
  "merges": [
    [1, 0]
  ]
}`,
  },
];
