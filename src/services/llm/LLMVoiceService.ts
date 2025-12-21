import type {
  TextBlock,
  LLMCharacter,
  ExtractResponse,
  SpeakerAssignment,
  MergeResponse,
} from '@/state/types';
import type { ILogger, ProgressCallback } from '../interfaces';
import { defaultConfig } from '@/config';
import { LLMApiClient } from './LLMApiClient';
import { buildCodeMapping, mergeCharacters, applyMergeResponse } from './CharacterUtils';
import {
  type IPromptStrategy,
  type ExtractContext,
  type MergeContext,
  type AssignContext,
  type AssignResult,
  createDefaultStrategies,
} from './PromptStrategy';

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
 * Count occurrences of each character canonical name
 */
function countCharacterOccurrences(characters: LLMCharacter[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of characters) {
    const key = char.canonicalName.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Preprocess characters: filter rare ones (< minOccurrencePercent) and map to generic voices
 */
function preprocessCharacters(
  characters: LLMCharacter[],
  occurrenceCounts: Map<string, number>,
  totalOccurrences: number,
  minOccurrencePercent: number,
  logger?: ILogger
): LLMCharacter[] {
  const minOccurrence = Math.max(1, Math.floor(totalOccurrences * minOccurrencePercent));

  const result: LLMCharacter[] = [];
  let maleGeneric: LLMCharacter | null = null;
  let femaleGeneric: LLMCharacter | null = null;
  let unknownGeneric: LLMCharacter | null = null;
  let removedCount = 0;

  for (const char of characters) {
    const key = char.canonicalName.toLowerCase();
    const count = occurrenceCounts.get(key) ?? 0;

    if (count >= minOccurrence) {
      result.push(char);
    } else {
      removedCount++;
      // Map to generic based on gender (create once, reuse)
      if (char.gender === 'male') {
        maleGeneric ??= { canonicalName: 'unknown_male', variations: [], gender: 'male' };
      } else if (char.gender === 'female') {
        femaleGeneric ??= { canonicalName: 'unknown_female', variations: [], gender: 'female' };
      } else {
        unknownGeneric ??= { canonicalName: 'unknown', variations: [], gender: 'unknown' };
      }
    }
  }

  // Add generic characters if any rare chars were mapped to them
  if (maleGeneric) result.push(maleGeneric);
  if (femaleGeneric) result.push(femaleGeneric);
  if (unknownGeneric) result.push(unknownGeneric);

  if (removedCount > 0) {
    logger?.info(`[Merge] Preprocessed: ${characters.length} → ${result.length} characters (${removedCount} rare chars → generic)`);
  }

  return result;
}

/**
 * Majority vote helper for 3-way voting.
 * Returns the code that appears at least 2 times, or first vote (temp 0.0) as tiebreaker.
 */
function majorityVote(
  votes: (string | undefined)[],
  paragraphIndex: number
): string | undefined {
  const counts = new Map<string, number>();
  for (const v of votes) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find majority (>=2 of 3)
  for (const [code, count] of counts) {
    if (count >= 2) return code;
  }

  // No majority - log debug and use 0.0 as tiebreaker
  console.debug(`[Voting] No majority for paragraph ${paragraphIndex}: ${votes.join(', ')} → using ${votes[0]}`);
  return votes[0];
}

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
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger: ILogger; // Required - prevents silent failures
  // Optional separate config for merge stage
  mergeConfig?: {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low';
    temperature?: number;
    topP?: number;
  };
  // Optional strategy overrides (for testing or custom implementations)
  strategies?: {
    extract?: IPromptStrategy<ExtractContext, ExtractResponse>;
    merge?: IPromptStrategy<MergeContext, MergeResponse>;
    assign?: IPromptStrategy<AssignContext, AssignResult>;
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
  private logger: ILogger;

  // Prompt strategies
  private extractStrategy: IPromptStrategy<ExtractContext, ExtractResponse>;
  private mergeStrategy: IPromptStrategy<MergeContext, MergeResponse>;
  private assignStrategy: IPromptStrategy<AssignContext, AssignResult>;

  constructor(options: LLMVoiceServiceOptions) {
    if (!options.logger) {
      throw new Error('LLMVoiceService requires a logger');
    }
    this.options = options;
    this.logger = options.logger;
    this.apiClient = new LLMApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
      streaming: options.streaming,
      reasoning: options.reasoning,
      temperature: options.temperature,
      topP: options.topP,
      directoryHandle: options.directoryHandle,
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
          directoryHandle: options.directoryHandle,
          logger: options.logger,
        })
      : this.apiClient;

    // Initialize strategies (use provided or defaults)
    const defaultStrategies = createDefaultStrategies();
    this.extractStrategy = options.strategies?.extract ?? defaultStrategies.extract;
    this.mergeStrategy = options.strategies?.merge ?? defaultStrategies.merge;
    this.assignStrategy = options.strategies?.assign ?? defaultStrategies.assign;
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
   * Extract: Extract characters from text blocks (sequential)
   */
  async extractCharacters(
    blocks: TextBlock[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    this.logger?.info(`[Extract] Starting (${blocks.length} blocks)`);
    const allCharacters: LLMCharacter[] = [];
    this.abortController = new AbortController();
    this.apiClient.resetLogging();

    for (let i = 0; i < blocks.length; i++) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      onProgress?.(i + 1, blocks.length);

      const block = blocks[i];
      const blockText = block.sentences.join('\n');
      const context: ExtractContext = { textBlock: blockText };

      const response = await this.apiClient.callWithRetry(
        this.extractStrategy.buildPrompt(context),
        (res) => this.extractStrategy.validateResponse(res, context),
        this.abortController.signal,
        [],
        'extract'
      );

      // With infinite retries, this should never be null
      if (response === null) {
        throw new Error('Extract failed unexpectedly');
      }

      const parsed = this.extractStrategy.parseResponse(response, context);
      allCharacters.push(...parsed.characters);

      // Small delay between requests to avoid overwhelming LLM server
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Simple merge by canonicalName first
    // Count occurrences before merge (for preprocessing)
    const occurrenceCounts = countCharacterOccurrences(allCharacters);
    const totalOccurrences = allCharacters.length;
    let merged = mergeCharacters(allCharacters);

    // LLM merge only if multiple blocks were processed and multiple characters exist
    if (blocks.length > 1 && merged.length > 1) {
      onProgress?.(blocks.length, blocks.length, `Merging ${merged.length} characters...`);
      merged = await this.mergeCharactersWithLLM(merged, occurrenceCounts, totalOccurrences, onProgress);
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
    const maxConcurrent = defaultConfig.llm.maxConcurrentRequests;
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
   * Process a single block for Assign
   */
  private async processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>
  ): Promise<SpeakerAssignment[]> {
    this.logger?.debug(`[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`);
    const hasSpeech = block.sentences.some(p => hasSpeechSymbols(p));

    if (!hasSpeech) {
      return block.sentences.map((text, i) => ({
        sentenceIndex: block.sentenceStartIndex + i,
        text,
        speaker: 'narrator',
        voiceId: this.options.narratorVoice,
      }));
    }

    // Use 0-based indexing for LLM (most models prefer this)
    const numberedParagraphs = block.sentences
      .map((s, i) => `[${i}] ${s}`)
      .join('\n');

    // Build context for strategy
    const context: AssignContext = {
      characters,
      nameToCode,
      codeToName,
      numberedParagraphs,
      sentenceCount: block.sentences.length,
    };

    const prompt = this.assignStrategy.buildPrompt(context);
    const validator = (result: string) => this.assignStrategy.validateResponse(result, context);

    let relativeMap: Map<number, string>;

    if (this.options.useVoting) {
      // 3-way voting with different temperatures (sequential with delays)
      const responses: (string | null)[] = [];
      for (let i = 0; i < VOTING_TEMPERATURES.length; i++) {
        const client = new LLMApiClient({
          ...this.options,
          temperature: VOTING_TEMPERATURES[i],
        });
        const response = await client.callWithRetry(
          prompt,
          validator,
          this.abortController?.signal,
          [],
          'assign',
          undefined,
          defaultConfig.llm.maxAssignRetries
        );
        responses.push(response);
        if (i < VOTING_TEMPERATURES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
        }
      }

      // Check if all voting attempts failed - fall back to narrator
      const validResponses = responses.filter((r): r is string => r !== null);
      if (validResponses.length === 0) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed after max retries (all voting attempts), using default voice for ${block.sentences.length} sentences`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }

      // Parse valid responses only using strategy
      const parsedMaps = validResponses.map(r => this.assignStrategy.parseResponse(r, context).speakerMap);

      // Majority vote for each paragraph (use available responses)
      relativeMap = new Map();
      for (let i = 0; i < block.sentences.length; i++) {
        const votes = parsedMaps.map(m => m.get(i));
        const winner = majorityVote(votes, block.sentenceStartIndex + i);
        if (winner) relativeMap.set(i, winner);
      }
    } else {
      // Single call (original behavior)
      const response = await this.apiClient.callWithRetry(
        prompt,
        validator,
        this.abortController?.signal,
        [],
        'assign',
        undefined,
        defaultConfig.llm.maxAssignRetries
      );

      // Handle max retries exceeded - fall back to narrator
      if (response === null) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed after max retries, using default voice for ${block.sentences.length} sentences`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }

      relativeMap = this.assignStrategy.parseResponse(response, context).speakerMap;
    }

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const relativeIndex = i; // 0-based
      const hasSpeech = hasSpeechSymbols(text);
      const speaker = hasSpeech ? (relativeMap.get(relativeIndex) || 'narrator') : 'narrator';
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
   * LLM-based character merge using 5-way voting with median selection
   * 1. Preprocess: filter rare characters (< 0.1%) to generic voices
   * 2. Run merge 5x with different temperatures
   * 3. Pick result with median character count
   */
  private async mergeCharactersWithLLM(
    characters: LLMCharacter[],
    occurrenceCounts: Map<string, number>,
    totalOccurrences: number,
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    const { mergeVotingTemperatures, mergeMinOccurrencePercent } = defaultConfig.llm;

    // Phase 1: Preprocess - filter rare characters
    const preprocessed = preprocessCharacters(
      characters,
      occurrenceCounts,
      totalOccurrences,
      mergeMinOccurrencePercent,
      this.logger
    );

    // If only generic characters remain, skip LLM merge
    if (preprocessed.length <= 3) {
      this.logger?.info(`[Merge] Only ${preprocessed.length} characters after preprocessing, skipping LLM merge`);
      return preprocessed;
    }

    // Phase 2: 5-way voting merge
    this.logger?.info(`[Merge] Starting 5-way voting merge with ${preprocessed.length} characters`);
    const results: LLMCharacter[][] = [];

    for (let i = 0; i < mergeVotingTemperatures.length; i++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const temp = mergeVotingTemperatures[i];
      onProgress?.(i + 1, mergeVotingTemperatures.length, `Merge vote ${i + 1}/${mergeVotingTemperatures.length} (temp=${temp})...`);

      const result = await this.singleMerge(preprocessed, temp, onProgress);
      if (result !== null) {
        results.push(result);
        this.logger?.info(`[Merge] Vote ${i + 1}/${mergeVotingTemperatures.length} (temp=${temp}): ${result.length} characters`);
      } else {
        this.logger?.warn(`[Merge] Vote ${i + 1}/${mergeVotingTemperatures.length} (temp=${temp}) failed, skipping`);
      }

      // Small delay between votes to avoid rate limits
      if (i < mergeVotingTemperatures.length - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Need at least 1 successful vote
    if (results.length === 0) {
      this.logger?.error(`[Merge] All ${mergeVotingTemperatures.length} votes failed, returning preprocessed characters`);
      return preprocessed;
    }

    // Phase 3: Pick median result by character count
    results.sort((a, b) => a.length - b.length);
    const medianIndex = Math.floor(results.length / 2);
    const median = results[medianIndex];

    this.logger?.info(`[Merge] Voting results: [${results.map(r => r.length).join(', ')}] → picked median: ${median.length} characters`);

    return median;
  }

  /**
   * Single merge operation with specified temperature
   * Returns null if max retries exceeded
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[] | null> {
    this.logger?.info(`[Merge] Single merge: ${characters.length} characters (temp=${temperature})`);

    // Build context for strategy
    const context: MergeContext = { characters };

    // Create a client with the specified temperature
    const client = new LLMApiClient({
      apiKey: this.options.mergeConfig?.apiKey ?? this.options.apiKey,
      apiUrl: this.options.mergeConfig?.apiUrl ?? this.options.apiUrl,
      model: this.options.mergeConfig?.model ?? this.options.model,
      streaming: this.options.mergeConfig?.streaming ?? this.options.streaming,
      reasoning: this.options.mergeConfig?.reasoning ?? this.options.reasoning,
      temperature: temperature,
      topP: this.options.mergeConfig?.topP ?? this.options.topP,
      directoryHandle: this.options.directoryHandle,
      logger: this.logger,
    });

    const response = await client.callWithRetry(
      this.mergeStrategy.buildPrompt(context),
      (result) => this.mergeStrategy.validateResponse(result, context),
      this.abortController?.signal,
      [],
      'merge',
      (attempt, delay, errors) => {
        const errorCount = errors?.length || 0;
        const reason = errorCount ? ` (${errorCount} errors): ${errors![errors!.length - 1]}` : '';
        onProgress?.(0, 0, `Merge validation failed${reason}, retry ${attempt} in ${Math.round(delay / 1000)}s...`);
      },
      defaultConfig.llm.maxMergeRetries
    );

    // Return null if max retries exceeded
    if (response === null) {
      this.logger?.warn(`[Merge] Vote failed after ${defaultConfig.llm.maxMergeRetries} retries (temp=${temperature})`);
      return null;
    }

    // Parse and apply response using strategy
    const parsed = this.mergeStrategy.parseResponse(response, context);
    return applyMergeResponse(characters, parsed);
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
