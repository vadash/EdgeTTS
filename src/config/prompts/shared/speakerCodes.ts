// src/config/prompts/shared/speakerCodes.ts
// Shared body sections for the assign and QA stage prompts.
// Both stages embed the same speaker-code roster, trailing overlap context,
// and numbered-paragraph skeleton; only the stage-specific block differs.

import type { LLMCharacter } from '@/state/types';

/**
 * Format the <speaker_codes> roster: one line per known character
 * (code, canonical name, gender tag, aliases), then one line per
 * UNNAMED placeholder entry from the code map.
 */
export function formatSpeakerCodeList(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
): string {
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

  return [...characterLines, ...unnamedEntries].join('\n');
}

/**
 * Format trailing overlap sentences as negative-index context the model
 * must read but not assign. Returns '' when there is nothing to include.
 */
export function formatOverlapContext(overlapSentences?: string[]): string {
  if (!overlapSentences || overlapSentences.length === 0) {
    return '';
  }
  const count = overlapSentences.length;
  const lines = overlapSentences.map((text, i) => `[${i - count}] ${text}`);
  return `<previous_context_do_not_assign>\n${lines.join('\n')}\n</previous_context_do_not_assign>`;
}

/**
 * Shared user-message body for assign and QA: speaker codes, overlap
 * context, numbered paragraphs, then the stage-specific block
 * (final instruction, draft assignments, ...).
 */
export function buildAssignmentBody(
  speakerCodes: string,
  previousContext: string,
  numberedParagraphs: string,
  stageContent: string,
): string {
  return `<speaker_codes>
${speakerCodes}
</speaker_codes>

${previousContext}

<numbered_paragraphs>
${numberedParagraphs}
</numbered_paragraphs>

${stageContent}`;
}
