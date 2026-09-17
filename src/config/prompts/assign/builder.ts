// src/config/prompts/assign/builder.ts
// Pipeline stage 3 of 4: Extract -> Merge -> Assign -> QA

import type { LLMCharacter } from '@/state/types';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import {
  buildAssignmentBody,
  formatOverlapContext,
  formatSpeakerCodeList,
} from '../shared/speakerCodes';
import { getAssignExamples } from './examples';
import { ASSIGN_ROLE } from './role';
import { ASSIGN_RULES } from './rules';
import { ASSIGN_SCHEMA_TEXT } from './schema';

export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  overlapSentences?: string[],
  repeatPrompt: boolean = false,
) {
  const examples = getAssignExamples();
  const stageContent = `[FINAL INSTRUCTION]:
1. Assign the Speaker Codes provided in <speaker_codes> to the paragraphs above.
2. SKIP paragraphs that are purely narration (no dialogue, thoughts, or system brackets).
3. Be careful of names inside quotes -- they are listeners, not speakers (Vocative trap).
4. ONLY use the codes provided in <speaker_codes>. DO NOT use names.
5. Only assign speaker codes to paragraphs [0] and above.
Output the raw JSON now.`;

  const sys = assembleSystemPrompt(ASSIGN_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(ASSIGN_RULES, ASSIGN_SCHEMA_TEXT);
  const user = buildAssignmentBody(
    formatSpeakerCodeList(characters, nameToCode),
    formatOverlapContext(overlapSentences),
    numberedParagraphs,
    stageContent,
  );

  return buildMessages(sys, `${user}\n\n${constraints}`, undefined, undefined, repeatPrompt);
}
