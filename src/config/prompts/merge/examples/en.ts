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
    thinking: `Step 1: Cross-checking variations. 0 has ["System"], 1 has ["Interface"] -- no overlap. 2 has ["Alex"], 3 has ["Alexander Gray", "Alex"] -- they share "Alex".
Step 2: 0 (System) and 1 (Interface) are both game system entities -> merge.
Step 3: No Protagonist in this list.
Step 4: 0 and 1 are both female -> no conflict. 2 and 3 are both male -> no conflict.
Step 5: [0, 1] for systems (System is best name). [3, 2] for Alex (Alexander Gray is best name).`,
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
    thinking: `Step 1: No variation overlaps between characters.
Step 2: 0 (Blue Box), 1 (Notification), 3 (System), and 4 (Quest) are all game system entities -> merge into one group.
Step 3: No Protagonist.
Step 4: All are female -> no conflict.
Step 5: [3, 0, 1, 4] -- System is the best canonical name for the group.`,
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
    thinking: `Step 1: No shared variations between any pair.
Step 2: No system entities beyond the named characters.
Step 3: No Protagonist.
Step 4: All different genders or no overlap.
Step 5: No merges needed.`,
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
    thinking: `Step 1: No shared variations.
Step 2: No system entities.
Step 3: 0 is "Protagonist" and 1 is "Marcus Chen" (male, likely the main character based on variations count) -> merge.
Step 4: Both male, no conflict.
Step 5: [1, 0] -- "Marcus Chen" is the best/longest name. Protagonist gets absorbed.`,
    output: `{
  "reasoning": "Protagonist and Marcus Chen are likely the same person (male, main character). Marcus Chen is the better name. Elena and Lyra are different people.",
  "merges": [
    [1, 0]
  ]
}`,
  },
];
