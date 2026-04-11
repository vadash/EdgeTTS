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
  "reasoning": "0+1: sys. 3+2: shared 'Alex', both M. 4: uniq.",
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
  "reasoning": "0+1+3+4: all sys entities. 3=best name→[3,0,1,4].",
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
  "reasoning": "No shared names/roles.",
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
  "reasoning": "0+1: protag=Marcus(M, MC). 1=better name→[1,0]. Elena≠Lyra.",
  "merges": [
    [1, 0]
  ]
}`,
  },
];
