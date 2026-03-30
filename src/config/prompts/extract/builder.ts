// src/config/prompts/extract/builder.ts
// Pipeline stage 1 of 3: Extract → Merge → Assign
// Builds the complete message array for character extraction prompts.

import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import { getExtractExamples } from './examples';
import { EXTRACT_ROLE } from './role';
import { EXTRACT_RULES } from './rules';
import { EXTRACT_SCHEMA_TEXT } from './schema';

export function buildExtractPrompt(
  textBlock: string,
  detectedLanguage: string = 'en',
) {
  const examples = getExtractExamples();
  const sys = assembleSystemPrompt(EXTRACT_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(EXTRACT_RULES, EXTRACT_SCHEMA_TEXT);
  const user = `<input_text>
${textBlock}
</input_text>

Extract all speakers from the text above.
Remember:
- Only extract characters who ACTUALLY speak/communicate.
- People spoken TO are not speakers.
- "gender" must strictly be "male", "female", or "unknown".`;

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
