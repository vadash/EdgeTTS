import type {
  TextBlock,
  LLMCharacter,
  ExtractResponse,
  SpeakerAssignment,
} from '@/state/types';
import type { ILogger, ProgressCallback } from '../interfaces';
import { defaultConfig } from '@/config';
import { LLMApiClient } from './LLMApiClient';
import { buildCodeMapping, mergeCharacters, applyMergeGroups } from './CharacterUtils';
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

/**
 * Build consensus merge groups from multiple votes using Union-Find.
 * Pairs appearing in ≥2 of 5 votes get merged.
 * Returns 0-based index groups.
 */
function buildMergeConsensus(votes: number[][][], logger?: ILogger): number[][] {
  // Count how many votes have each pair in same group
  const pairCounts = new Map<string, number>();
  // Track which index was "keep" (first in group) for each pair
  const keepVotes = new Map<string, number[]>();

  for (const vote of votes) {
    for (const group of vote) {
      if (group.length < 2) continue;
      const keep = group[0];
      const sorted = [...group].sort((a, b) => a - b);

      // Count all pairs in this group
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]},${sorted[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          // Track who was keep for this pair
          if (!keepVotes.has(key)) keepVotes.set(key, []);
          keepVotes.get(key)!.push(keep);
        }
      }
    }
  }

  // Build edges from pairs with ≥2 votes (2 out of 5 is enough)
  const edges: [number, number][] = [];
  let pairsWithConsensus = 0;
  for (const [key, count] of pairCounts) {
    if (count >= 2) {
      const [a, b] = key.split(',').map(Number);
      edges.push([a, b]);
      pairsWithConsensus++;
    }
  }

  logger?.info(`[Merge] Consensus: ${pairCounts.size} unique pairs, ${pairsWithConsensus} with ≥2 votes`);

  // Union-Find to build connected components
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (x: number, y: number) => {
    const px = find(x), py = find(y);
    if (px !== py) parent.set(px, py);
  };

  for (const [a, b] of edges) {
    union(a, b);
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // For each group, pick "keep" as the most-voted keep index, or smallest
  const result: number[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue; // Skip singletons

    // Count keep votes for members of this group
    const keepCounts = new Map<number, number>();
    const sorted = [...members].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]},${sorted[j]}`;
        const keeps = keepVotes.get(key) ?? [];
        for (const k of keeps) {
          if (members.includes(k)) {
            keepCounts.set(k, (keepCounts.get(k) ?? 0) + 1);
          }
        }
      }
    }

    // Pick most-voted keep, or smallest index
    let keepIdx = Math.min(...members);
    let maxVotes = 0;
    for (const [idx, count] of keepCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        keepIdx = idx;
      }
    }

    // Build group with keep first
    result.push([keepIdx, ...members.filter(m => m !== keepIdx)]);
  }

  return result;
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
  maxConcurrentRequests?: number;
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
    merge?: IPromptStrategy<MergeContext, number[][]>;
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
  private mergeStrategy: IPromptStrategy<MergeContext, number[][]>;
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
    let merged = mergeCharacters(allCharacters);

    // LLM merge only if multiple blocks were processed and multiple characters exist
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

    // Always send blocks to LLM so it has full context for speaker assignment
    // (even blocks without obvious speech symbols may contain thoughts, telepathy, etc.)

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
      // Trust the LLM's assignment regardless of speech symbols
      const speaker = relativeMap.get(relativeIndex) || 'narrator';
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
   * Single merge operation with specified temperature
   * Returns merge groups (0-based indices) or null if max retries exceeded
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    onProgress?: ProgressCallback
  ): Promise<number[][] | null> {
    this.logger?.info(`[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`);

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
      this.logger?.warn(`[Merge] Vote failed after ${defaultConfig.llm.maxMergeRetries} retries (temp=${temperature.toFixed(2)})`);
      return null;
    }

    // Parse response to get merge groups (0-based indices)
    return this.mergeStrategy.parseResponse(response, context);
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
