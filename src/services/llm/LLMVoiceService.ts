import type {
  TextBlock,
  LLMCharacter,
  SpeakerAssignment,
} from '@/state/types';
import type { Logger } from '../Logger';

export type ProgressCallback = (current: number, total: number, message?: string) => void;
import { defaultConfig } from '@/config';
import { LLMApiClient } from './LLMApiClient';
import { DebugLogger } from './DebugLogger';
import { buildCodeMapping, mergeCharacters, applyMergeGroups } from './CharacterUtils';
import { majorityVote, buildMergeConsensus } from './votingConsensus';
import {
  buildExtractPrompt,
  buildMergePrompt,
  buildAssignPrompt,
  type ExtractContext,
  type MergeContext,
  type AssignContext,
} from './PromptStrategy';
import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
import { withRetry } from '@/utils/retry';
import { getErrorMessage } from '@/errors';

/**
 * Unambiguous speech/dialogue symbols (no contraction risk):
 * " - Double quote
 * « » - Guillemets (U+00AB, U+00BB)
 * ‹ › - Single guillemets (U+2039, U+203A)
 * — - Em dash (U+2014)
 * " " - Curly double quotes (U+201C, U+201D)
 * „ - Low double quote (U+201E)
 * ' - Left single quote (U+2018) - opening quote, not used in contractions
 */
const UNAMBIGUOUS_SPEECH_REGEX = /["\u00AB\u00BB\u2014\u201C\u201D\u201E\u2039\u203A\u2018]/;

/**
 * Apostrophe-like characters that could be contractions:
 * ' (U+0027) - straight apostrophe/quote
 * ' (U+2019) - right single quote (smart quote, also used as apostrophe)
 * ` (U+0060) - backtick/grave accent
 * ʼ (U+02BC) - modifier letter apostrophe
 * ′ (U+2032) - prime
 * ＇ (U+FF07) - fullwidth apostrophe
 */
const APOSTROPHE_LIKE_REGEX = /['\u2019`\u02BC\u2032\uFF07]/g;

/**
 * Check if character at index is part of a contraction (letter on both sides)
 */
const isContraction = (text: string, index: number): boolean => {
  const prev = text[index - 1] || '';
  const next = text[index + 1] || '';
  // Letter before AND after = contraction (e.g., don't, it's, won't)
  return /[\p{L}]/u.test(prev) && /[\p{L}]/u.test(next);
};

/**
 * Check if text contains speech/dialogue symbols.
 * Handles apostrophe-like characters by excluding contractions.
 */
export const hasSpeechSymbols = (text: string): boolean => {
  // Fast path: unambiguous speech markers
  if (UNAMBIGUOUS_SPEECH_REGEX.test(text)) return true;

  // Check apostrophe-like chars - only count if NOT a contraction
  // Reset regex lastIndex for global regex
  APOSTROPHE_LIKE_REGEX.lastIndex = 0;
  let match;
  while ((match = APOSTROPHE_LIKE_REGEX.exec(text)) !== null) {
    if (!isContraction(text, match.index)) return true;
  }
  return false;
};

/**
 * Voting temperatures for 3-way voting (assign step)
 */
const VOTING_TEMPERATURES = [0.1, 0.4, 0.7] as const;

/**
 * Delay between LLM API calls (ms)
 */
const LLM_DELAY_MS = 1000;

/**
 * Options for creating LLM service instances
 * Aliased as LLMServiceFactoryOptions for DI compatibility
 */
export interface LLMVoiceServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  useVoting?: boolean;
  repeatPrompt?: boolean;
  maxConcurrentRequests?: number;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger: Logger; // Required - prevents silent failures
  // Optional separate config for merge stage
  mergeConfig?: {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low';
    temperature?: number;
    topP?: number;
    repeatPrompt?: boolean;
  };
}

/**
 * LLMVoiceService - Orchestrates LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private apiClient: LLMApiClient;
  private mergeApiClient: LLMApiClient;
  private abortController: AbortController | null = null;
  private logger: Logger;

  constructor(options: LLMVoiceServiceOptions) {
    if (!options.logger) {
      throw new Error('LLMVoiceService requires a logger');
    }
    this.options = options;
    this.logger = options.logger;
    const debugLogger = new DebugLogger(options.directoryHandle, options.logger);
    this.apiClient = new LLMApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
      streaming: options.streaming,
      reasoning: options.reasoning,
      temperature: options.temperature,
      topP: options.topP,
      debugLogger,
      logger: options.logger,
    });

    // Use separate merge config if provided, otherwise use main config
    const mergeConfig = options.mergeConfig;
    this.mergeApiClient = mergeConfig
      ? new LLMApiClient({
          apiKey: mergeConfig.apiKey,
          apiUrl: mergeConfig.apiUrl,
          model: mergeConfig.model,
          streaming: mergeConfig.streaming ?? options.streaming,
          reasoning: mergeConfig.reasoning ?? options.reasoning,
          temperature: mergeConfig.temperature ?? options.temperature,
          topP: mergeConfig.topP ?? options.topP,
          debugLogger,
          logger: options.logger,
        })
      : this.apiClient;
  }

  /**
   * Cancel ongoing operations
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Extract: Extract characters from text blocks using structured outputs
   */
  async extractCharacters(
    blocks: TextBlock[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    this.logger?.info(`[Extract] Starting (${blocks.length} blocks)`);
    const allCharacters: LLMCharacter[] = [];
    const controller = new AbortController();
    this.abortController = controller;
    this.apiClient.resetLogging();

    for (let i = 0; i < blocks.length; i++) {
      if (controller.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      onProgress?.(i + 1, blocks.length);

      const block = blocks[i];
      const blockText = block.sentences.join('\n');

      const response = await withRetry(
        () => this.apiClient.callStructured({
          prompt: buildExtractPrompt(blockText),
          schema: ExtractSchema,
          schemaName: 'ExtractSchema',
          signal: controller.signal,
        }),
        {
          maxRetries: Infinity, // Keep retrying until valid
          signal: controller.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(`[Extract] Block ${i + 1}/${blocks.length} retry ${attempt}: ${getErrorMessage(error)}`);
          },
        }
      );

      allCharacters.push(...response.characters);

      // Small delay between requests
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Simple merge by canonicalName
    let merged = mergeCharacters(allCharacters);

    // LLM merge if multiple blocks and characters
    if (blocks.length > 1 && merged.length > 1) {
      onProgress?.(blocks.length, blocks.length, `Merging ${merged.length} characters...`);
      merged = await this.mergeCharactersWithLLM(merged, onProgress);
      onProgress?.(blocks.length, blocks.length, `Merged to ${merged.length} characters`);
    }

    return merged;
  }

  /**
   * Assign: Assign speakers to sentences (parallel, respects maxConcurrentRequests)
   */
  async assignSpeakers(
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<SpeakerAssignment[]> {
    const maxConcurrent = this.options.maxConcurrentRequests ?? defaultConfig.llm.maxConcurrentRequests;
    this.logger?.info(`[Assign] Starting (${blocks.length} blocks, max ${maxConcurrent} concurrent${this.options.useVoting ? ', voting enabled' : ''})`);
    const results: SpeakerAssignment[] = [];
    let completed = 0;

    this.abortController = new AbortController();

    // Build code mapping from characters (including variations)
    const { nameToCode, codeToName } = buildCodeMapping(characters);

    // Process blocks in batches
    for (let i = 0; i < blocks.length; i += maxConcurrent) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const batch = blocks.slice(i, i + maxConcurrent);
      this.logger?.info(`[Assign] Processing batch of ${batch.length} blocks`);
      const batchPromises = batch.map((block, batchIndex) => {
        const blockNum = i + batchIndex + 1;
        this.logger?.info(`[assign] Starting block ${blockNum}/${blocks.length}`);
        return this.processAssignBlock(block, characterVoiceMap, characters, nameToCode, codeToName)
          .then(result => {
            this.logger?.info(`[assign] Completed block ${blockNum}/${blocks.length}`);
            return result;
          })
          .catch(err => {
            this.logger?.error(`[assign] Error in block ${blockNum}`, err instanceof Error ? err : new Error(String(err)));
            throw err;
          });
      });

      const batchResults = await Promise.all(batchPromises);

      for (const blockAssignments of batchResults) {
        results.push(...blockAssignments);
        completed++;
        onProgress?.(completed, blocks.length);
      }

      // Small delay between batches to avoid overwhelming LLM server
      if (i + maxConcurrent < blocks.length) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Sort by sentence index
    results.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    return results;
  }

  /**
   * Process a single block for Assign using structured outputs
   * New format: sparse JSON object {"0": "A", "5": "B"}
   */
  private async processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>
  ): Promise<SpeakerAssignment[]> {
    this.logger?.debug(`[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`);

    // Always send blocks to LLM so it has full context for speaker assignment
    // (even blocks without obvious speech symbols may contain thoughts, telepathy, etc.)

    // Use 0-based indexing for LLM (most models prefer this)
    const numberedParagraphs = block.sentences
      .map((s, i) => `[${i}] ${s}`)
      .join('\n');

    // Build context
    const context: AssignContext = {
      characters,
      nameToCode,
      codeToName,
      numberedParagraphs,
      sentenceCount: block.sentences.length,
    };

    const prompt = buildAssignPrompt(context.characters, context.nameToCode, context.numberedParagraphs);

    let relativeMap: Map<number, string>;

    if (this.options.useVoting) {
      // 3-way voting with different temperatures (sequential with delays)
      const responses: (object | null)[] = [];
      for (let i = 0; i < VOTING_TEMPERATURES.length; i++) {
        const client = new LLMApiClient({
          ...this.options,
          temperature: VOTING_TEMPERATURES[i],
          logger: this.logger,
        });

        try {
          const response = await client.callStructured({
            prompt,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal: this.abortController?.signal,
          });
          responses.push(response);
        } catch (e) {
          this.logger?.warn(`[assign] Vote ${i + 1} failed: ${getErrorMessage(e)}`);
          responses.push(null);
        }

        if (i < VOTING_TEMPERATURES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
        }
      }

      // Check if all voting attempts failed - fall back to narrator
      const validResponses = responses.filter((r): r is object => r !== null);
      if (validResponses.length === 0) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed (all voting attempts), using default voice for ${block.sentences.length} sentences`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }

      // Parse valid responses: convert sparse assignments to Map<number, string>
      const parsedMaps = validResponses.map((r: any) => {
        const map = new Map<number, string>();
        for (const [key, code] of Object.entries(r.assignments)) {
          const idx = parseInt(key, 10);
          if (codeToName.has(code as string)) {
            map.set(idx, code as string);
          }
        }
        return map;
      });

      // Majority vote for each paragraph (use available responses)
      relativeMap = new Map();
      for (let i = 0; i < block.sentences.length; i++) {
        const votes = parsedMaps.map(m => m.get(i));
        const winner = majorityVote(votes, block.sentenceStartIndex + i);
        if (winner) relativeMap.set(i, winner);
      }
    } else {
      // Single call (original behavior)
      try {
        const response = await this.apiClient.callStructured({
          prompt,
          schema: AssignSchema,
          schemaName: 'AssignSchema',
          signal: this.abortController?.signal,
        });

        // Convert sparse object to Map
        relativeMap = new Map();
        for (const [key, code] of Object.entries(response.assignments)) {
          const index = parseInt(key, 10);
          if (context.codeToName.has(code)) {
            relativeMap.set(index, code);
          }
        }
      } catch (e) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed, using default voice for ${block.sentences.length} sentences`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }
    }

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const relativeIndex = i; // 0-based
      // Trust the LLM's assignment regardless of speech symbols
      const speakerCode = relativeMap.get(relativeIndex);
      // Convert code back to canonical name
      const speaker = speakerCode ? codeToName.get(speakerCode) ?? 'narrator' : 'narrator';
      return {
        sentenceIndex: absoluteIndex,
        text,
        speaker,
        voiceId: speaker === 'narrator'
          ? this.options.narratorVoice
          : characterVoiceMap.get(speaker) ?? this.options.narratorVoice,
      };
    });
  }

  /**
   * LLM-based character merge using 5-way voting with consensus
   * 1. Run merge 5x with random temperatures (0.0-1.0)
   * 2. Build consensus from all votes (pairs with ≥2 votes)
   */
  private async mergeCharactersWithLLM(
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    const { mergeVoteCount } = defaultConfig.llm;

    // Skip if too few characters
    if (characters.length <= 1) {
      return characters;
    }

    // 5-way voting merge with random temperatures
    this.logger?.info(`[Merge] Starting ${mergeVoteCount}-way voting merge with ${characters.length} characters`);
    const votes: number[][][] = [];

    for (let i = 0; i < mergeVoteCount; i++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const temp = Math.round(Math.random() * 10) / 10; // Random temperature 0.0-1.0, rounded to 0.1
      onProgress?.(i + 1, mergeVoteCount, `Merge vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)})...`);

      const mergeGroups = await this.singleMerge(characters, temp, onProgress);
      if (mergeGroups !== null) {
        votes.push(mergeGroups);
        this.logger?.info(`[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}): ${mergeGroups.length} merges`);
      } else {
        this.logger?.warn(`[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}) failed, skipping`);
      }

      // Small delay between votes to avoid rate limits
      if (i < mergeVoteCount - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Need at least 1 successful vote
    if (votes.length === 0) {
      this.logger?.error(`[Merge] All ${mergeVoteCount} votes failed, returning original characters`);
      return characters;
    }

    // Build consensus from all votes
    const consensusGroups = buildMergeConsensus(votes, this.logger);
    this.logger?.info(`[Merge] Consensus: ${consensusGroups.length} merges from ${votes.length} votes`);

    // Apply consensus to characters
    const result = applyMergeGroups(characters, consensusGroups);
    this.logger?.info(`[Merge] Final: ${result.length} characters`);

    return result;
  }

  /**
   * Single merge operation with specified temperature using structured outputs
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    onProgress?: ProgressCallback
  ): Promise<number[][] | null> {
    this.logger?.info(`[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`);

    // Create a client with the specified temperature
    const client = new LLMApiClient({
      apiKey: this.options.mergeConfig?.apiKey ?? this.options.apiKey,
      apiUrl: this.options.mergeConfig?.apiUrl ?? this.options.apiUrl,
      model: this.options.mergeConfig?.model ?? this.options.model,
      streaming: false,  // Always non-streaming for structured outputs
      reasoning: this.options.mergeConfig?.reasoning ?? this.options.reasoning,
      temperature: temperature,
      topP: this.options.mergeConfig?.topP ?? this.options.topP,
      debugLogger: new DebugLogger(this.options.directoryHandle, this.logger),
      logger: this.logger,
    });

    try {
      const response = await client.callStructured({
        prompt: buildMergePrompt(characters),
        schema: MergeSchema,
        schemaName: 'MergeSchema',
        signal: this.abortController?.signal,
      });
      return response.merges;
    } catch (error) {
      this.logger?.warn(`[Merge] Vote failed (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Test API connection (non-streaming)
   */
  async testConnection(): Promise<{ success: boolean; error?: string; model?: string }> {
    return this.apiClient.testConnection();
  }

  /**
   * Test API connection (streaming/SSE)
   */
  async testConnectionStreaming(): Promise<{ success: boolean; error?: string; model?: string }> {
    return this.apiClient.testConnectionStreaming();
  }
}

// Type alias for DI factory compatibility
export type LLMServiceFactoryOptions = LLMVoiceServiceOptions;
