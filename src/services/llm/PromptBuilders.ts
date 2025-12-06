import type { LLMCharacter } from '@/state/types';
import type { LLMPrompt } from './LLMApiClient';
import { LLM_PROMPTS } from '@/config/prompts';

/**
 * Build Extract prompt (character extraction)
 */
export function buildExtractPrompt(textBlock: string): LLMPrompt {
  return {
    system: LLM_PROMPTS.extract.system,
    user: LLM_PROMPTS.extract.userTemplate.replace('{{text}}', textBlock),
  };
}

/**
 * Build Merge prompt (character deduplication)
 */
export function buildMergePrompt(characters: LLMCharacter[]): LLMPrompt {
  const characterList = characters
    .map((c, i) => `${i + 1}. canonicalName: "${c.canonicalName}", variations: ${JSON.stringify(c.variations)}, gender: ${c.gender}`)
    .join('\n');

  return {
    system: LLM_PROMPTS.merge.system,
    user: LLM_PROMPTS.merge.userTemplate.replace('{{characters}}', characterList),
  };
}

/**
 * Build Assign prompt (speaker assignment)
 */
export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  _startIndex: number
): LLMPrompt {
  // Build character codes with aliases/variations
  const characterLines = characters.map((char) => {
    const code = nameToCode.get(char.canonicalName)!;
    const aliases = char.variations.filter((v) => v !== char.canonicalName);
    const genderInfo = char.gender !== 'unknown' ? ` [${char.gender}]` : '';
    if (aliases.length > 0) {
      return `- \`${code}\` = ${char.canonicalName}${genderInfo} (aliases: ${aliases.join(', ')})`;
    }
    return `- \`${code}\` = ${char.canonicalName}${genderInfo}`;
  });

  // Get unnamed codes
  const unnamedEntries = Array.from(nameToCode.entries())
    .filter(([name]) => name.includes('UNNAMED'))
    .map(([name, code]) => `- \`${code}\` = ${name}`);

  // Build system prompt from template parts
  const system = LLM_PROMPTS.assign.systemPrefix
    .replace('{{characterLines}}', characterLines.join('\n'))
    .replace('{{unnamedEntries}}', unnamedEntries.join('\n'))
    + LLM_PROMPTS.assign.systemSuffix;

  return {
    system,
    user: LLM_PROMPTS.assign.userTemplate.replace('{{paragraphs}}', numberedParagraphs),
  };
}
