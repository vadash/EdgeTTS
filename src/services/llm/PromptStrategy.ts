// PromptStrategy.ts - Strategy Pattern for LLM Prompts
// Decouples prompt building, validation, and parsing from LLMVoiceService

import type { LLMPrompt } from './LLMApiClient';
import type { LLMCharacter, LLMValidationResult, ExtractResponse, MergeResponse } from '@/state/types';
import { buildExtractPrompt, buildMergePrompt, buildAssignPrompt } from './PromptBuilders';
import {
  validateExtractResponse,
  validateMergeResponse,
  validateAssignResponse,
  parseAssignResponse,
  fixMergeResponse,
} from './ResponseValidators';
import { extractJSON } from '@/utils/llmUtils';

/**
 * Base interface for all prompt strategies
 */
export interface IPromptStrategy<TContext, TResult> {
  buildPrompt(context: TContext): LLMPrompt;
  validateResponse(response: string, context: TContext): LLMValidationResult;
  parseResponse(response: string, context: TContext): TResult;
}

/**
 * Context for Extract prompt
 */
export interface ExtractContext {
  textBlock: string;
}

/**
 * Context for Merge prompt
 */
export interface MergeContext {
  characters: LLMCharacter[];
}

/**
 * Context for Assign prompt
 */
export interface AssignContext {
  characters: LLMCharacter[];
  nameToCode: Map<string, string>;
  codeToName: Map<string, string>;
  numberedParagraphs: string;
  sentenceCount: number;
}

/**
 * Result from Assign parsing
 */
export interface AssignResult {
  speakerMap: Map<number, string>;
}

// Concrete Strategy Implementations

/**
 * Extract Strategy - Character extraction from text blocks
 */
export class ExtractPromptStrategy implements IPromptStrategy<ExtractContext, ExtractResponse> {
  buildPrompt(context: ExtractContext): LLMPrompt {
    return buildExtractPrompt(context.textBlock);
  }

  validateResponse(response: string, _context: ExtractContext): LLMValidationResult {
    return validateExtractResponse(response);
  }

  parseResponse(response: string, _context: ExtractContext): ExtractResponse {
    const cleaned = extractJSON(response);
    return JSON.parse(cleaned) as ExtractResponse;
  }
}

/**
 * Merge Strategy - Character deduplication/merging
 */
export class MergePromptStrategy implements IPromptStrategy<MergeContext, MergeResponse> {
  buildPrompt(context: MergeContext): LLMPrompt {
    return buildMergePrompt(context.characters);
  }

  validateResponse(response: string, context: MergeContext): LLMValidationResult {
    return validateMergeResponse(response, context.characters);
  }

  parseResponse(response: string, context: MergeContext): MergeResponse {
    // Fix response by auto-adding any missing characters
    const fixedResponse = fixMergeResponse(response, context.characters);
    return JSON.parse(fixedResponse) as MergeResponse;
  }
}

/**
 * Assign Strategy - Speaker assignment to sentences
 */
export class AssignPromptStrategy implements IPromptStrategy<AssignContext, AssignResult> {
  buildPrompt(context: AssignContext): LLMPrompt {
    return buildAssignPrompt(
      context.characters,
      context.nameToCode,
      context.numberedParagraphs,
      0 // startIndex always 0 for 0-based indexing
    );
  }

  validateResponse(response: string, context: AssignContext): LLMValidationResult {
    return validateAssignResponse(response, context.sentenceCount, context.codeToName);
  }

  parseResponse(response: string, context: AssignContext): AssignResult {
    return {
      speakerMap: parseAssignResponse(response, context.codeToName),
    };
  }
}

/**
 * Factory function to create default strategies
 */
export function createDefaultStrategies(): {
  extract: IPromptStrategy<ExtractContext, ExtractResponse>;
  merge: IPromptStrategy<MergeContext, MergeResponse>;
  assign: IPromptStrategy<AssignContext, AssignResult>;
} {
  return {
    extract: new ExtractPromptStrategy(),
    merge: new MergePromptStrategy(),
    assign: new AssignPromptStrategy(),
  };
}
