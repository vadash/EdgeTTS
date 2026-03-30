// src/config/prompts/merge/builder.ts
// Pipeline stage 2 of 3: Extract -> Merge -> Assign
// Builds the complete message array for character deduplication prompts.

import type { LLMCharacter } from '@/state/types';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import { getMergeExamples } from './examples';
import { MERGE_ROLE } from './role';
import { MERGE_RULES } from './rules';
import { MERGE_SCHEMA_TEXT } from './schema';

export function buildMergePrompt(characters: LLMCharacter[], detectedLanguage: string = 'en') {
  const examples = getMergeExamples();
  const characterList = characters
    .map(
      (c, i) =>
        `${i}. canonicalName: "${c.canonicalName}", variations: ${JSON.stringify(c.variations)}, gender: ${c.gender}`,
    )
    .join('\n');

  const sys = assembleSystemPrompt(MERGE_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(MERGE_RULES, MERGE_SCHEMA_TEXT);
  const user = `<character_list>
${characterList}
</character_list>

Find the duplicates in the numbered list above.
If characters share a variation, or are clearly the same entity (like System and Interface), group their numbers together.
The first number in each group must be the best/longest name.
If no merges are needed, output "merges": [].`;

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
