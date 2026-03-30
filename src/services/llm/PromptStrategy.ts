// PromptStrategy.ts - LLM Prompt building, validation, and parsing
// Build functions delegated to domain-specific builders.
// Parse functions remain here (schema validation is separate from prompt construction).

import type { LLMCharacter } from '@/state/types';
import type { ExtractResponse, MergeResponse } from './schemas';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';

// ============================================================================
// Re-exports from domain builders
// ============================================================================

export { buildAssignPrompt } from '@/config/prompts/assign/builder';
export { buildExtractPrompt } from '@/config/prompts/extract/builder';
export { buildMergePrompt } from '@/config/prompts/merge/builder';

// ============================================================================
// Context Types (kept here for backward compatibility)
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

  const unknownCode = context.nameToCode.get('UNKNOWN_UNNAMED') || '3';

  const speakerMap = new Map<number, string>();
  for (const [key, code] of Object.entries(parsed.assignments)) {
    const index = parseInt(key, 10);
    if (context.codeToName.has(code)) {
      speakerMap.set(index, code);
    } else {
      speakerMap.set(index, unknownCode);
    }
  }

  return { speakerMap };
}
