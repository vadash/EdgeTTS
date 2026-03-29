// PromptStrategy.ts - LLM Prompt building, validation, and parsing
// Pure functions for character extraction, merging, and speaker assignment

import { LLM_PROMPTS } from '@/config/prompts';
import type { LLMCharacter } from '@/state/types';
import type { LLMMessage } from './promptFormatters';
import { assembleSystemPrompt, assembleUserConstraints, buildMessages } from './promptFormatters';
import type { ExtractResponse, MergeResponse } from './schemas';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';

// ============================================================================
// Context Types
// ============================================================================

export interface ExtractContext {
  textBlock: string;
}

export interface MergeContext {
  characters: LLMCharacter[];
}

export interface AssignContext {
  characters: LLMCharacter[];
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
  numberedParagraphs: string;
  sentenceCount: number;
}

export interface AssignResult {
  speakerMap: Map<number, string>;
}

// ============================================================================
// Prompt Building
// ============================================================================

export function buildExtractPrompt(
  textBlock: string,
  detectedLanguage: string = 'en',
): LLMMessage[] {
  const p = LLM_PROMPTS.extract;
  const sys = assembleSystemPrompt(p.role, p.examples);
  const constraints = assembleUserConstraints(p.rules, p.schemaText);
  const user = p.userTemplate.replace('{{text}}', textBlock);
  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}

export function buildMergePrompt(
  characters: LLMCharacter[],
  detectedLanguage: string = 'en',
): LLMMessage[] {
  const p = LLM_PROMPTS.merge;
  const characterList = characters
    .map(
      (c, i) =>
        `${i}. canonicalName: "${c.canonicalName}", variations: ${JSON.stringify(c.variations)}, gender: ${c.gender}`,
    )
    .join('\n');

  const sys = assembleSystemPrompt(p.role, p.examples);
  const constraints = assembleUserConstraints(p.rules, p.schemaText);
  const user = p.userTemplate.replace('{{characters}}', characterList);
  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}

export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  detectedLanguage: string = 'en',
  overlapSentences?: string[],
): LLMMessage[] {
  const p = LLM_PROMPTS.assign;

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

  // Build overlap context with negative indices
  let previousContext = '';
  if (overlapSentences && overlapSentences.length > 0) {
    const count = overlapSentences.length;
    const lines = overlapSentences.map((text, i) => `[${i - count}] ${text}`);
    previousContext = `<previous_context_do_not_assign>\n${lines.join('\n')}\n</previous_context_do_not_assign>`;
  }

  const sys = assembleSystemPrompt(p.role, p.examples);
  const constraints = assembleUserConstraints(p.rules, p.schemaText);
  const user = p.userTemplate
    .replace('{{paragraphs}}', numberedParagraphs)
    .replace('{{characterLines}}', characterLinesStr)
    .replace('{{unnamedEntries}}', unnamedEntriesStr)
    .replace('{{previousContext}}', previousContext);

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}

// ============================================================================
// Response Parsing
// ============================================================================

export function parseExtractResponse(response: unknown): ExtractResponse {
  return ExtractSchema.parse(response);
}

export function parseMergeResponse(response: unknown): MergeResponse {
  return MergeSchema.parse(response);
}

export function parseAssignResponse(response: unknown, context: AssignContext): AssignResult {
  const parsed = AssignSchema.parse(response);

  // Convert sparse object to Map
  const speakerMap = new Map<number, string>();
  for (const [key, code] of Object.entries(parsed.assignments)) {
    const index = parseInt(key, 10);
    if (context.codeToName.has(code)) {
      speakerMap.set(index, code);
    }
  }

  return { speakerMap };
}
