// src/config/prompts/qa/builder.ts

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
import { getQAExamples } from './examples';
import { QA_ROLE } from './role';
import { QA_RULES } from './rules';
import { QA_SCHEMA_TEXT } from './schema';

export function buildQAPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  draftAssignments: Record<string, string>,
  overlapSentences?: string[],
  repeatPrompt: boolean = false,
) {
  const examples = getQAExamples();
  const draftJson = JSON.stringify(draftAssignments, null, 2);
  const stageContent = `<draft_assignments>
${draftJson}
</draft_assignments>

[FINAL INSTRUCTION]:
Review the draft assignments above and correct any errors.
Output the corrected JSON now.`;

  const sys = assembleSystemPrompt(QA_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(QA_RULES, QA_SCHEMA_TEXT);
  const user = buildAssignmentBody(
    formatSpeakerCodeList(characters, nameToCode),
    formatOverlapContext(overlapSentences),
    numberedParagraphs,
    stageContent,
  );

  return buildMessages(sys, `${user}\n\n${constraints}`, undefined, undefined, repeatPrompt);
}
