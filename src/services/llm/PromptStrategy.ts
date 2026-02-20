// PromptStrategy.ts - LLM Prompt building, validation, and parsing
// Functions for character extraction, merging, and speaker assignment

import type { LLMPrompt } from './LLMApiClient';
import type { LLMCharacter, LLMValidationResult, ExtractResponse } from '@/state/types';
import { LLM_PROMPTS } from '@/config/prompts';
import {
  validateExtractResponse,
  validateMergeResponse,
  validateAssignResponse,
  parseAssignResponse as parseAssignResponseInternal,
  parseMergeResponse as parseMergeResponseInternal,
  repairExtractCharacters,
  repairAssignResponse,
} from './ResponseValidators';
import { extractJSON } from '@/utils/llmUtils';

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
// Strategy Interface (for testability)
// ============================================================================

export interface IPromptStrategy<TContext, TResult> {
  buildPrompt(context: TContext): LLMPrompt;
  validateResponse(response: string, context: TContext): LLMValidationResult;
  parseResponse(response: string, context: TContext): TResult;
}

// ============================================================================
// Prompt Building
// ============================================================================

export function buildExtractPrompt(textBlock: string): LLMPrompt {
  return {
    system: LLM_PROMPTS.extract.system,
    user: LLM_PROMPTS.extract.userTemplate.replace('{{text}}', textBlock),
  };
}

export function buildMergePrompt(characters: LLMCharacter[]): LLMPrompt {
  const characterList = characters
    .map((c, i) => `${i}. canonicalName: "${c.canonicalName}", variations: ${JSON.stringify(c.variations)}, gender: ${c.gender}`)
    .join('\n');

  return {
    system: LLM_PROMPTS.merge.system,
    user: LLM_PROMPTS.merge.userTemplate.replace('{{characters}}', characterList),
  };
}

export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string
): LLMPrompt {
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

  const system = LLM_PROMPTS.assign.system
    .replaceAll('{{characterLines}}', characterLinesStr)
    .replaceAll('{{unnamedEntries}}', unnamedEntriesStr);

  const user = LLM_PROMPTS.assign.userTemplate
    .replaceAll('{{paragraphs}}', numberedParagraphs)
    .replaceAll('{{characterLines}}', characterLinesStr)
    .replaceAll('{{unnamedEntries}}', unnamedEntriesStr);

  return { system, user };
}

// ============================================================================
// Response Parsing
// ============================================================================

export function parseExtractResponse(response: string): ExtractResponse {
  const cleaned = extractJSON(response);
  const parsed = JSON.parse(cleaned) as ExtractResponse;
  const repair = repairExtractCharacters(parsed.characters as any[]);
  parsed.characters = repair.characters as any;
  return parsed;
}

export function parseMergeResponse(response: string, context: MergeContext): number[][] {
  const validation = validateMergeResponse(response, context.characters);
  const finalResponse = validation.repairedResponse || response;
  return parseMergeResponseInternal(finalResponse);
}

export function parseAssignResponse(response: string, context: AssignContext): AssignResult {
  const validCodes = new Set(context.codeToName.keys());
  const repaired = repairAssignResponse(response, validCodes);
  const validation = validateAssignResponse(response, context.sentenceCount, context.codeToName);
  const finalResponse = validation.repairedResponse || repaired;
  return {
    speakerMap: parseAssignResponseInternal(finalResponse, context.codeToName),
  };
}

// ============================================================================
// Default Strategy Implementations (function objects for testability)
// ============================================================================

export const extractStrategy: IPromptStrategy<ExtractContext, ExtractResponse> = {
  buildPrompt: (ctx) => buildExtractPrompt(ctx.textBlock),
  validateResponse: (res) => validateExtractResponse(res),
  parseResponse: (res) => parseExtractResponse(res),
};

export const mergeStrategy: IPromptStrategy<MergeContext, number[][]> = {
  buildPrompt: (ctx) => buildMergePrompt(ctx.characters),
  validateResponse: (res, ctx) => validateMergeResponse(res, ctx.characters),
  parseResponse: (res, ctx) => parseMergeResponse(res, ctx),
};

export const assignStrategy: IPromptStrategy<AssignContext, AssignResult> = {
  buildPrompt: (ctx) => buildAssignPrompt(ctx.characters, ctx.nameToCode, ctx.numberedParagraphs),
  validateResponse: (res, ctx) => validateAssignResponse(res, ctx.sentenceCount, ctx.codeToName),
  parseResponse: (res, ctx) => parseAssignResponse(res, ctx),
};

export function createDefaultStrategies() {
  return {
    extract: extractStrategy,
    merge: mergeStrategy,
    assign: assignStrategy,
  };
}

// Backward compatibility exports (classes were removed)
export const ExtractPromptStrategy = class implements IPromptStrategy<ExtractContext, ExtractResponse> {
  buildPrompt = extractStrategy.buildPrompt;
  validateResponse = extractStrategy.validateResponse;
  parseResponse = extractStrategy.parseResponse;
};

export const MergePromptStrategy = class implements IPromptStrategy<MergeContext, number[][]> {
  buildPrompt = mergeStrategy.buildPrompt;
  validateResponse = mergeStrategy.validateResponse;
  parseResponse = mergeStrategy.parseResponse;
};

export const AssignPromptStrategy = class implements IPromptStrategy<AssignContext, AssignResult> {
  buildPrompt = assignStrategy.buildPrompt;
  validateResponse = assignStrategy.validateResponse;
  parseResponse = assignStrategy.parseResponse;
};
