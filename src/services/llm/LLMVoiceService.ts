import type { LLMCharacter, SpeakerAssignment, TextBlock } from '@/state/types';
import type { ILogger } from '../Logger';

export type ProgressCallback = (current: number, total: number, message?: string) => void;

import { defaultConfig } from '@/config';
import { buildQAPrompt } from '@/config/prompts/qa/builder';
import { getErrorMessage } from '@/errors';
import { withRetry } from '@/utils/retry';
import {
  applyMergeGroups,
  buildCodeMapping,
  cullByFrequency,
  mergeCharacters,
} from './CharacterUtils';
import { DebugLogger } from './DebugLogger';
import { LLMApiClient } from './LLMApiClient';
import {
  type AssignContext,
  buildAssignPrompt,
  buildExtractPrompt,
  buildMergePrompt,
} from './PromptStrategy';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';
import { buildMergeConsensus } from './votingConsensus';
import { runWithConcurrency } from './runWithConcurrency';

/**
 * Unambiguous speech/dialogue symbols (no contraction risk):
 * " - Double quote
 * << >> - Guillemets (U+00AB, U+00BB)
 * < > - Single guillemets (U+2039, U+203A)
 * -- - Em dash (U+2014)
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
 * ' (U+2032) - prime
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
  let match: RegExpExecArray | null;
  while ((match = APOSTROPHE_LIKE_REGEX.exec(text)) !== null) {
    if (!isContraction(text, match.index)) return true;
  }
  return false;
};

/**
 * Number of sentences from the previous block to pass as overlap context
 */
const OVERLAP_SIZE = 10;

/**
 * Delay between LLM API calls (ms)
 */
const LLM_DELAY_MS = 1000;

/**
 * Default retry counts for each operation
 */
const RETRY_CONFIG = {
  extract: Infinity, // Extract: keep retrying until valid
  merge: 3, // Merge: 3 retries per vote attempt
  assign: 3, // Assign: 3 retries per block attempt
} as const;

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
  reasoning?: 'auto' | 'high' | 'medium' | 'low' | null;
  temperature?: number;
  topP?: number;
  useVoting?: boolean;
  repeatPrompt?: boolean;
  maxConcurrentRequests?: number;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger: ILogger; // Required - prevents silent failures
  detectedLanguage?: string; // NEW - for auto prefill selection
  // Optional separate config for merge stage
  mergeConfig?: {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low' | null;
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
  public mergeApiClient: LLMApiClient;
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private detectedLanguage: string; // NEW - store for prompt building

  constructor(options: LLMVoiceServiceOptions) {
    if (!options.logger) {
      throw new Error('LLMVoiceService requires a logger');
    }
    this.options = options;
    this.logger = options.logger;
    this.detectedLanguage = options.detectedLanguage ?? 'en'; // NEW - default to English
    const debugLogger = new DebugLogger(options.directoryHandle, options.logger);
    this.apiClient = new LLMApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
      streaming: options.streaming,
      reasoning: options.reasoning,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: defaultConfig.llm.maxTokens,
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
          maxTokens: defaultConfig.llm.maxTokens,
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
    onProgress?: ProgressCallback,
  ): Promise<LLMCharacter[]> {
    this.logger?.info(`[Extract] Starting (${blocks.length} blocks)`);
    const controller = new AbortController();
    this.abortController = controller;
    this.apiClient.resetLogging();

    // Map blocks to task thunks for parallel execution
    const tasks = blocks.map(
      (block, i) => () => this.extractBlock(block, i, blocks.length, controller),
    );

    // Run tasks with concurrency control
    const responses = await runWithConcurrency(tasks, {
      concurrency: this.options.maxConcurrentRequests ?? 2,
      signal: controller.signal,
      onProgress: (completed, total) => onProgress?.(completed, total),
    });

    // Collect all characters
    const allCharacters: LLMCharacter[] = [];
    for (const response of responses) {
      allCharacters.push(...response.characters);
    }

    // Save first extract phase log
    if (responses[0]?.debugLog) {
      await this.apiClient.debugLogger?.savePhaseLog(
        'extract',
        { messages: responses[0].debugLog.messages },
        responses[0].debugLog.response,
      );
    }

    // Simple merge by canonicalName
    let merged = mergeCharacters(allCharacters);

    // Pre-merge frequency culling (remove hallucinated/noise characters)
    const fullText = blocks
      .map((b) => b.sentences.join('\n'))
      .join('\n')
      .toLowerCase();
    const beforeCull = merged.length;
    merged = cullByFrequency(merged, fullText);
    this.logger?.info(
      `[Extract] Culled ${beforeCull - merged.length}/${beforeCull} characters by frequency. Remaining: ${merged.length}`,
    );

    // LLM merge if multiple blocks and characters
    if (blocks.length > 1 && merged.length > 1) {
      onProgress?.(blocks.length, blocks.length, `Merging ${merged.length} characters...`);
      merged = await this.mergeCharactersWithLLM(merged, onProgress);
      onProgress?.(blocks.length, blocks.length, `Merged to ${merged.length} characters`);
    }

    return merged;
  }

  /**
   * Extract characters from a single block
   */
  private async extractBlock(
    block: TextBlock,
    index: number,
    total: number,
    controller: AbortController,
  ): Promise<{ characters: LLMCharacter[]; debugLog?: { messages: object; response: object } }> {
    const blockText = block.sentences.join('\n');

    const extractMessages = buildExtractPrompt(
      blockText,
      this.detectedLanguage,
      this.options.repeatPrompt ?? false,
    );

    const response = await withRetry(
      () =>
        this.apiClient.callStructured({
          messages: extractMessages,
          schema: ExtractSchema,
          schemaName: 'ExtractSchema',
          signal: controller.signal,
        }),
      {
        maxRetries: RETRY_CONFIG.extract,
        signal: controller.signal,
        onRetry: (attempt, error) => {
          this.logger?.warn(
            `[Extract] Block ${index + 1}/${total} retry ${attempt}: ${getErrorMessage(error)}`,
          );
        },
      },
    );

    // Collect debug log for first block only
    const debugLog = index === 0 ? { messages: extractMessages, response } : undefined;

    return { characters: response.characters, debugLog };
  }

  /**
   * Assign: Assign speakers to sentences (parallel, respects maxConcurrentRequests)
   */
  async assignSpeakers(
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    onProgress?: ProgressCallback,
  ): Promise<SpeakerAssignment[]> {
    const maxConcurrent =
      this.options.maxConcurrentRequests ?? defaultConfig.llm.maxConcurrentRequests;
    this.logger?.info(
      `[Assign] Starting (${blocks.length} blocks, max ${maxConcurrent} concurrent${this.options.useVoting ? ', voting enabled' : ''})`,
    );

    this.abortController = new AbortController();

    // Build code mapping from characters (including variations)
    const { nameToCode, codeToName } = buildCodeMapping(characters);

    // Build task array for parallel processing
    const tasks = blocks.map((block, globalIndex) => {
      const blockNum = globalIndex + 1;
      return () => {
        const overlapSentences =
          globalIndex > 0 ? blocks[globalIndex - 1].sentences.slice(-OVERLAP_SIZE) : undefined;
        this.logger?.info(`[assign] Starting block ${blockNum}/${blocks.length}`);
        return this.processAssignBlock(
          block,
          characterVoiceMap,
          characters,
          nameToCode,
          codeToName,
          overlapSentences,
          globalIndex === 0, // isFirstBlock
        )
          .then((result) => {
            this.logger?.info(`[assign] Completed block ${blockNum}/${blocks.length}`);
            return result;
          })
          .catch((err) => {
            this.logger?.error(
              `[assign] Error in block ${blockNum}`,
              err instanceof Error ? err : new Error(String(err)),
            );
            throw err;
          });
      };
    });

    // Run all tasks with concurrency control
    const results = await runWithConcurrency(tasks, {
      concurrency: maxConcurrent,
      signal: this.abortController.signal,
      onProgress,
    });

    // Flatten and sort by sentence index
    const flatResults = results.flat();
    flatResults.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    return flatResults;
  }

  /**
   * Process a single block for Assign using structured outputs
   * New format: sparse JSON object {"0": "A", "5": "B"}
   * When useVoting is enabled: runs Assign -> QA sequential flow
   */
  private async processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>,
    overlapSentences?: string[],
    isFirstBlock: boolean = false,
  ): Promise<SpeakerAssignment[]> {
    this.logger.debug?.(
      `[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`,
    );

    // Use 0-based indexing for LLM
    const numberedParagraphs = block.sentences.map((s, i) => `[${i}] ${s}`).join('\n');

    // Build context
    const context: AssignContext = {
      characters,
      nameToCode,
      codeToName,
      numberedParagraphs,
      sentenceCount: block.sentences.length,
    };

    const assignMessages = buildAssignPrompt(
      context.characters,
      context.nameToCode,
      context.numberedParagraphs,
      this.detectedLanguage,
      overlapSentences,
      this.options.repeatPrompt ?? false,
    );

    let relativeMap: Map<number, string>;

    try {
      // Step 1: Always run the initial Assign call
      const draftResponse = await withRetry(
        () =>
          this.apiClient.callStructured({
            messages: assignMessages,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal: this.abortController?.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.assign,
          signal: this.abortController?.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[assign] Block at ${block.sentenceStartIndex} retry ${attempt}/${RETRY_CONFIG.assign}: ${getErrorMessage(error)}`,
            );
          },
        },
      );

      // Convert draft response to Map
      const draftMap = new Map<number, string>();
      for (const [key, code] of Object.entries(draftResponse.assignments)) {
        const index = parseInt(key, 10);
        if (context.codeToName.has(code)) {
          draftMap.set(index, code);
        }
      }

      // Save first assign phase log (draft)
      if (isFirstBlock) {
        await this.apiClient.debugLogger?.savePhaseLog(
          'assign_draft',
          { messages: assignMessages },
          draftResponse,
        );
      }

      // Step 2: If useVoting is enabled, run QA pass
      if (this.options.useVoting) {
        const qaMessages = buildQAPrompt(
          context.characters,
          context.nameToCode,
          context.numberedParagraphs,
          draftResponse.assignments,
          this.detectedLanguage,
          overlapSentences,
          this.options.repeatPrompt ?? false,
        );

        try {
          const qaResponse = await withRetry(
            () =>
              this.apiClient.callStructured({
                messages: qaMessages,
                schema: AssignSchema,
                schemaName: 'AssignSchema',
                signal: this.abortController?.signal,
              }),
            {
              maxRetries: RETRY_CONFIG.assign,
              signal: this.abortController?.signal,
              onRetry: (attempt, error) => {
                this.logger?.warn(
                  `[assign] QA pass at ${block.sentenceStartIndex} retry ${attempt}/${RETRY_CONFIG.assign}: ${getErrorMessage(error)}`,
                );
              },
            },
          );

          // Convert QA response to Map
          relativeMap = new Map<number, string>();
          for (const [key, code] of Object.entries(qaResponse.assignments)) {
            const index = parseInt(key, 10);
            if (context.codeToName.has(code)) {
              relativeMap.set(index, code);
            }
          }

          // Save QA phase log
          if (isFirstBlock) {
            await this.apiClient.debugLogger?.savePhaseLog(
              'assign_qa',
              { messages: qaMessages },
              qaResponse,
            );
          }

          this.logger?.info(
            `[assign] Block at ${block.sentenceStartIndex} completed with QA correction`,
          );
        } catch (qaError) {
          // QA failed - fall back to draft results
          this.logger?.warn(
            `[assign] QA pass failed at ${block.sentenceStartIndex}, using draft: ${getErrorMessage(qaError)}`,
          );
          relativeMap = draftMap;
        }
      } else {
        // No QA pass - use draft directly
        relativeMap = draftMap;
      }
    } catch (_e) {
      this.logger?.warn(
        `[assign] Block at ${block.sentenceStartIndex} failed after ${RETRY_CONFIG.assign} retries, using default voice for ${block.sentences.length} sentences`,
      );
      return block.sentences.map((text, i) => ({
        sentenceIndex: block.sentenceStartIndex + i,
        text,
        speaker: 'narrator',
        voiceId: this.options.narratorVoice,
      }));
    }

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const relativeIndex = i;
      const speakerCode = relativeMap.get(relativeIndex);
      const speaker = speakerCode ? (codeToName.get(speakerCode) ?? 'narrator') : 'narrator';
      return {
        sentenceIndex: absoluteIndex,
        text,
        speaker,
        voiceId:
          speaker === 'narrator'
            ? this.options.narratorVoice
            : (characterVoiceMap.get(speaker) ?? this.options.narratorVoice),
      };
    });
  }

  /**
   * LLM-based character merge using 5-way voting with consensus
   * 1. Run merge 5x with random temperatures (0.0-1.0)
   * 2. Build consensus from all votes (pairs with >=2 votes)
   */
  private async mergeCharactersWithLLM(
    characters: LLMCharacter[],
    onProgress?: ProgressCallback,
  ): Promise<LLMCharacter[]> {
    const { mergeVoteCount } = defaultConfig.llm;

    // Skip if too few characters
    if (characters.length <= 1) {
      return characters;
    }

    // 5-way voting merge with random temperatures
    this.logger?.info(
      `[Merge] Starting ${mergeVoteCount}-way voting merge with ${characters.length} characters`,
    );
    const votes: number[][][] = [];

    for (let i = 0; i < mergeVoteCount; i++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const temp = 0.1 + Math.round(Math.random() * 6) / 10; // Random temperature 0.1-0.7, rounded to 0.1
      onProgress?.(
        i + 1,
        mergeVoteCount,
        `Merge vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)})...`,
      );

      const mergeGroups = await this.singleMerge(characters, temp, onProgress, i);
      if (mergeGroups !== null) {
        votes.push(mergeGroups);
        this.logger?.info(
          `[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}): ${mergeGroups.length} merges`,
        );
      } else {
        this.logger?.warn(
          `[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}) failed, skipping`,
        );
      }

      // Small delay between votes to avoid rate limits
      if (i < mergeVoteCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Need at least 1 successful vote
    if (votes.length === 0) {
      this.logger?.error(
        `[Merge] All ${mergeVoteCount} votes failed, returning original characters`,
      );
      return characters;
    }

    // Build consensus from all votes
    const consensusGroups = buildMergeConsensus(votes, this.logger);
    this.logger?.info(
      `[Merge] Consensus: ${consensusGroups.length} merges from ${votes.length} votes`,
    );

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
    _onProgress?: ProgressCallback,
    voteIndex?: number, // track which vote this is
  ): Promise<number[][] | null> {
    this.logger?.info(
      `[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`,
    );

    const mergeMessages = buildMergePrompt(
      characters,
      this.detectedLanguage,
      this.options.mergeConfig?.repeatPrompt ?? false,
    );

    // Create a client with the specified temperature
    const client = new LLMApiClient({
      apiKey: this.options.mergeConfig?.apiKey ?? this.options.apiKey,
      apiUrl: this.options.mergeConfig?.apiUrl ?? this.options.apiUrl,
      model: this.options.mergeConfig?.model ?? this.options.model,
      streaming: false, // Always non-streaming for structured outputs
      reasoning: this.options.mergeConfig?.reasoning ?? this.options.reasoning,
      temperature: temperature,
      topP: this.options.mergeConfig?.topP ?? this.options.topP,
      maxTokens: defaultConfig.llm.maxTokens,
      debugLogger: this.apiClient.debugLogger, // share debugLogger
      logger: this.logger,
    });

    try {
      const response = await withRetry(
        () =>
          client.callStructured({
            messages: mergeMessages,
            schema: MergeSchema,
            schemaName: 'MergeSchema',
            signal: this.abortController?.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.merge,
          signal: this.abortController?.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[Merge] Retry ${attempt}/${RETRY_CONFIG.merge} (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
            );
          },
        },
      );

      // Save first merge phase log
      if (voteIndex === 0) {
        await this.apiClient.debugLogger?.savePhaseLog(
          'merge',
          { messages: mergeMessages },
          response,
        );
      }

      return response.merges;
    } catch (error) {
      this.logger?.warn(
        `[Merge] Vote failed after ${RETRY_CONFIG.merge} retries (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
      );
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
