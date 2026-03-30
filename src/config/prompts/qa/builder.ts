// src/config/prompts/qa/builder.ts
// Builds the QA prompt that reviews draft assignments

import type { LLMCharacter } from '@/state/types';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import { getQAExamples } from './examples';
import { QA_ROLE } from './role';
import { QA_RULES } from './rules';
import { QA_SCHEMA_TEXT } from './schema';

export function buildQAPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  draftAssignments: Record<string, string>,
  detectedLanguage: string = 'en',
  overlapSentences?: string[],
) {
  const examples = getQAExamples();

  const characterLines = characters.map((char) => {
    const code = nameToCode.get(char.canonicalName)!;
    const aliases = char.variations.filter((v) => v !== char.canonicalName);
    const genderInfo = char.gender !== 'unknown' ? ` [${char.gender}]` : '';
    if (aliases.length > 0) {
      return `- ${code} = ${char.canonicalName}${genderInfo} (aliases: ${aliases.join(', ')})`;
    }
    return `- ${code} = ${char.canonicalName}${genderInfo}`;
  });

  const unnamedEntries = Array.from(nameToCode.entries())
    .filter(([name]) => name.includes('UNNAMED'))
    .map(([name, code]) => `- ${code} = ${name}`);

  const characterLinesStr = characterLines.join('\n');
  const unnamedEntriesStr = unnamedEntries.join('\n');

  let previousContext = '';
  if (overlapSentences && overlapSentences.length > 0) {
    const count = overlapSentences.length;
    const lines = overlapSentences.map((text, i) => `[${i - count}] ${text}`);
    previousContext = `<previous_context_do_not_assign>\n${lines.join('\n')}\n</previous_context_do_not_assign>`;
  }

  const draftJson = JSON.stringify(draftAssignments, null, 2);

  const sys = assembleSystemPrompt(QA_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(QA_RULES, QA_SCHEMA_TEXT);
  const user = `<speaker_codes>
${characterLinesStr}
${unnamedEntriesStr}
</speaker_codes>

${previousContext}

<numbered_paragraphs>
${numberedParagraphs}
</numbered_paragraphs>

<draft_assignments>
${draftJson}
</draft_assignments>

[FINAL INSTRUCTION]:
Review the draft assignments above and correct any errors.
Output the corrected JSON now.`;

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
