// src/config/prompts/assign/builder.ts
// Pipeline stage 3 of 3: Extract → Merge → Assign
// Builds the complete message array for speaker attribution prompts.

import type { LLMCharacter } from '@/state/types';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import { getAssignExamples } from './examples';
import { ASSIGN_ROLE } from './role';
import { ASSIGN_RULES } from './rules';
import { ASSIGN_SCHEMA_TEXT } from './schema';

export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  detectedLanguage: string = 'en',
  overlapSentences?: string[],
) {
  const examples = getAssignExamples();

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

  const sys = assembleSystemPrompt(ASSIGN_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(ASSIGN_RULES, ASSIGN_SCHEMA_TEXT);
  const user = `<speaker_codes>
${characterLinesStr}
${unnamedEntriesStr}
</speaker_codes>

${previousContext}

<numbered_paragraphs>
${numberedParagraphs}
</numbered_paragraphs>

[FINAL INSTRUCTION]:
1. Assign Speaker Codes (A, B, C...) to the paragraphs above.
2. SKIP paragraphs that are purely narration (no dialogue, thoughts, or system brackets).
3. Be careful of names inside quotes — they are listeners, not speakers (Vocative trap).
4. ONLY use the codes provided in <speaker_codes>. DO NOT use names.
5. Only assign speaker codes to paragraphs [0] and above.
Output the raw JSON now.`;

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
