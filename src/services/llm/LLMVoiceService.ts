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
import {
  AssignSchema,
  ExtractSchema,
  MergeSchema,
  type AssignResponse,
  type ExtractResponse,
} from './schemas';
import type { StructuredCallOptions } from './schemaUtils';
import { buildMergeConsensus } from './votingConsensus';
import { collectVotes, spreadTemps } from './collectVotes';
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

const DEFAULT_MAX_RETRIES = 3;

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
  corsMiddleware?: string;
  maxRetries?: number;
  maxConcurrentRequests?: number;
  /** Live effective LLM concurrency as the rate-limit gate reacts. */
  onConcurrencyChange?: (effective: number) => void;
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
    maxRetries?: number;
    corsMiddleware?: string;
  };
  /** Optional backup model — used when this stage exhausts maxRetries */
  backupConfig?: {
    apiKey: string;
    apiUrl: string;
    model: string;
    streaming?: boolean;
    reasoning?: 'auto' | 'high' | 'medium' | 'low' | null;
    temperature?: number;
    topP?: number;
    repeatPrompt?: boolean;
    corsMiddleware?: string;
    maxRetries?: number;
  };
}

/**
 * LLMVoiceService - Orchestrates LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  public apiClient: LLMApiClient;
  public mergeApiClient: LLMApiClient;
  public backupApiClient: LLMApiClient | null;
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private detectedLanguage!: string; // Store for prompt building

  constructor(options: LLMVoiceServiceOptions) {
    if (!options.logger) {
      throw new Error('LLMVoiceService requires a logger');
    }
    this.options = options;
    this.logger = options.logger;
    const debugLogger = new DebugLogger(options.directoryHandle, options.logger);
    this.backupApiClient = options.backupConfig
      ? new LLMApiClient({
          apiKey: options.backupConfig.apiKey,
          apiUrl: options.backupConfig.apiUrl,
          model: options.backupConfig.model,
          streaming: options.backupConfig.streaming ?? options.streaming,
          reasoning: options.backupConfig.reasoning ?? options.reasoning,
          temperature: options.backupConfig.temperature ?? options.temperature,
          topP: options.backupConfig.topP ?? options.topP,
          maxTokens: defaultConfig.llm.maxTokens,
          corsMiddleware: options.backupConfig.corsMiddleware ?? options.corsMiddleware,
          debugLogger,
          logger: options.logger,
        })
      : null;
    this.apiClient = new LLMApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
      streaming: options.streaming,
      reasoning: options.reasoning,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: defaultConfig.llm.maxTokens,
      corsMiddleware: options.corsMiddleware,
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
          corsMiddleware: mergeConfig.corsMiddleware ?? options.corsMiddleware,
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
   * Call structured endpoint for a splittable stage (extract/assign): retry main
   * up to the user-set maxRetries, then fall back to the backup model with its own
   * maxRetries. If main + backup both exhaust, throw so the per-block handler can
   * degrade (extract skips the block, assign falls back to narrator).
   *
   * When `backup` is provided, it replaces the default "replay identical callArgs"
   * fallback — used by extract/assign to send two half-blocks to the backup model
   * (2-way split) instead of the full 8k/4k-token block. Primary stays whole.
   *
   * ponytail: merge deliberately does NOT use this path — it never falls back to
   * the backup model. The vote pool (`collectVotes`) replaces a failed attempt
   * with a fresh temperature; `mergeConfig.maxRetries` sizes that replacement
   * budget, not retries of the same call (see `mergeCharactersWithLLM`).
   */
  private async callWithStageBackup<T>(
    stage: 'extract' | 'assign',
    primaryClient: LLMApiClient,
    callArgs: StructuredCallOptions<T>,
    signal: AbortSignal | undefined,
    onRetry: (attempt: number, error: unknown) => void,
    backup?: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;

    try {
      return await withRetry(() => primaryClient.callStructured(callArgs), {
        maxRetries,
        signal,
        onRetry,
      });
    } catch (error) {
      // Don't fall back if aborted, or no backup configured
      if (signal?.aborted || !this.backupApiClient) throw error;

      this.logger?.warn(
        `[${stage}] Primary model exhausted ${maxRetries} retries, falling back to backup model (${this.options.backupConfig?.model})`,
      );

      // Custom backup path (2-way split) when provided; otherwise replay the
      // identical callArgs against the backup client.
      if (backup) return backup();

      const backupRetries = this.options.backupConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
      return withRetry(() => this.backupApiClient!.callStructured(callArgs), {
        maxRetries: backupRetries,
        signal,
        onRetry: (attempt, err) => {
          this.logger?.warn(
            `[${stage}] Backup retry ${attempt}/${backupRetries}: ${getErrorMessage(err)}`,
          );
        },
      });
    }
  }

  /**
   * Backup-only 2-way split for extract: when the primary exhausts retries on a
   * full block, split the block in half and send each half to the backup model
   * separately, then concatenate the characters. A single-line block can't be
   * split — the whole block is replayed. Primary is never split.
   *
   * ponytail: if either half exhausts the backup, the rejection propagates so
   * extractBlock's per-block degrade handler skips the block (a character spans
   * multiple blocks, so one block's absence heals upstream).
   */
  private async extractBackupSplit(
    blockText: string,
    signal: AbortSignal | undefined,
  ): Promise<ExtractResponse> {
    const backupRetries = this.options.backupConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const lines = blockText.split('\n');
    const mid = Math.ceil(lines.length / 2);
    // Drop empty halves so a 1-line block just replays the whole block.
    const halves = [lines.slice(0, mid), lines.slice(mid)].filter((h) => h.length > 0);

    const callHalf = (text: string) => {
      const messages = buildExtractPrompt(
        text,
        this.detectedLanguage,
        this.options.repeatPrompt ?? false,
      );
      return withRetry(
        () =>
          this.backupApiClient!.callStructured({
            messages,
            schema: ExtractSchema,
            schemaName: 'ExtractSchema',
            signal,
          }),
        {
          maxRetries: backupRetries,
          signal,
          onRetry: (attempt, err) => {
            this.logger?.warn(
              `[extract] Backup split retry ${attempt}/${backupRetries}: ${getErrorMessage(err)}`,
            );
          },
        },
      );
    };

    const responses = await Promise.all(halves.map((h) => callHalf(h.join('\n'))));
    return { characters: responses.flatMap((r) => r.characters), reasoning: null };
  }

  /**
   * Backup-only 2-way split for assign: when the primary exhausts retries on a
   * full block, split the numbered paragraphs in half, renumber the second
   * half from [0], and offset its returned keys back by the first-half length
   * on merge. A single-line block replays whole. Primary is never split.
   *
   * ponytail: if either half exhausts the backup, the rejection propagates so
   * processAssignBlock's per-block degrade handler falls back to narrator for
   * every sentence in the block.
   */
  private async assignBackupSplit(
    context: AssignContext,
    overlapSentences: string[] | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AssignResponse> {
    const backupRetries = this.options.backupConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const lines = context.numberedParagraphs.split('\n');
    const mid = Math.ceil(lines.length / 2);
    const firstLines = lines.slice(0, mid);
    const secondLines = lines.slice(mid).filter((l) => l.length > 0);
    const offset = firstLines.length;

    const callHalf = (numberedParagraphs: string) => {
      const messages = buildAssignPrompt(
        context.characters,
        context.nameToCode,
        numberedParagraphs,
        this.detectedLanguage,
        overlapSentences,
        this.options.repeatPrompt ?? false,
      );
      return withRetry(
        () =>
          this.backupApiClient!.callStructured({
            messages,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal,
          }),
        {
          maxRetries: backupRetries,
          signal,
          onRetry: (attempt, err) => {
            this.logger?.warn(
              `[assign] Backup split retry ${attempt}/${backupRetries}: ${getErrorMessage(err)}`,
            );
          },
        },
      );
    };

    // No second half (1-line block): replay whole block.
    if (secondLines.length === 0) {
      return callHalf(context.numberedParagraphs);
    }

    // Renumber second half from [0]; offset its returned keys back on merge.
    const firstText = firstLines.join('\n');
    const secondRenumbered = secondLines
      .map((line, i) => line.replace(/^\[\d+\]/, `[${i}]`))
      .join('\n');

    const [first, second] = await Promise.all([callHalf(firstText), callHalf(secondRenumbered)]);

    const merged: Record<string, string> = { ...first.assignments };
    for (const [key, code] of Object.entries(second.assignments)) {
      merged[String(parseInt(key, 10) + offset)] = code;
    }
    return { assignments: merged, reasoning: null };
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
    const responses = await runWithConcurrency(tasks, {
      concurrency: this.options.maxConcurrentRequests ?? 2,
      signal: controller.signal,
      onProgress: (completed, total) => onProgress?.(completed, total),
      onConcurrencyChange: this.options.onConcurrencyChange,
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
    try {
      const response = await this.callWithStageBackup(
        'extract',
        this.apiClient,
        {
          messages: extractMessages,
          schema: ExtractSchema,
          schemaName: 'ExtractSchema',
          signal: controller.signal,
        },
        controller.signal,
        (attempt, error) => {
          this.logger?.warn(
            `[Extract] Block ${index + 1}/${total} retry ${attempt}: ${getErrorMessage(error)}`,
          );
        },
        () => this.extractBackupSplit(blockText, controller.signal),
      );

      // Collect debug log for first block only
      const debugLog = index === 0 ? { messages: extractMessages, response } : undefined;
      return { characters: response.characters, debugLog };
    } catch (error) {
      // Cancellation propagates — never swallow an abort.
      if (controller.signal.aborted) throw error;
      // Character usually spans more than one block: skip a block that fails
      // main + backup rather than aborting the whole extract pass.
      this.logger?.warn(`[Extract] Block ${index + 1}/${total} failed after all retries, skipping`);
      return { characters: [] };
    }
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
      onConcurrencyChange: this.options.onConcurrencyChange,
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
      const draftResponse = await this.callWithStageBackup(
        'assign',
        this.apiClient,
        {
          messages: assignMessages,
          schema: AssignSchema,
          schemaName: 'AssignSchema',
          signal: this.abortController?.signal,
        },
        this.abortController?.signal,
        (attempt, error) => {
          this.logger?.warn(
            `[assign] Block at ${block.sentenceStartIndex} retry ${attempt}: ${getErrorMessage(error)}`,
          );
        },
        () => this.assignBackupSplit(context, overlapSentences, this.abortController?.signal),
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
          // QA retries the PRIMARY only — backup split never activates here. On
          // exhaustion the catch below falls back to draft (DRY with voting-off).
          const qaResponse = await withRetry(
            () =>
              this.apiClient.callStructured({
                messages: qaMessages,
                schema: AssignSchema,
                schemaName: 'AssignSchema',
                signal: this.abortController?.signal,
              }),
            {
              maxRetries: this.options.maxRetries ?? DEFAULT_MAX_RETRIES,
              signal: this.abortController?.signal,
              onRetry: (attempt, error) => {
                this.logger?.warn(
                  `[assign] QA pass at ${block.sentenceStartIndex} retry ${attempt}: ${getErrorMessage(error)}`,
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
        `[assign] Block at ${block.sentenceStartIndex} failed after all retries, using default voice for ${block.sentences.length} sentences`,
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
   * LLM-based character merge using voting with consensus.
   *
   * `need` votes fire concurrently at distinct temperatures, each with a
   * safety margin of replacement temps so a timed-out attempt is replaced by
   * a fresh temperature instead of retried at the same value. Consensus merges
   * pairs that survive >=2 of the gathered votes.
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

    // ponytail: one request per temperature, no same-temp retry. The budget
    // is need × (1 + maxRetries) — the user's maxRetries setting now sizes
    // how many replacement temperatures a dead attempt buys instead of how
    // many times the same dead temperature is re-sent. Capped at 60 because
    // spreadTemps collides above that on the 0.1-0.7 range.
    const maxRetries = this.options.mergeConfig?.maxRetries ?? defaultConfig.llm.maxMergeRetries;
    const budget = Math.min(60, mergeVoteCount * (1 + maxRetries));
    const parallel = Math.min(mergeVoteCount, budget);
    const temps = spreadTemps(budget);

    this.logger?.info(
      `[Merge] Starting ${mergeVoteCount}-way voting merge with ${characters.length} characters (parallel ${Math.min(parallel, temps.length)})`,
    );

    const votes = await collectVotes<number[][]>({
      need: mergeVoteCount,
      parallel,
      temps,
      signal: this.abortController?.signal,
      run: (temp, signal) => this.singleMerge(characters, temp, signal),
      onSettled: (ok, temp, count) => {
        onProgress?.(
          count,
          mergeVoteCount,
          `Merge vote ${count}/${mergeVoteCount} (temp=${temp.toFixed(2)})${ok ? '' : ' failed, replacing'}`,
        );
        if (ok) {
          this.logger?.info(
            `[Merge] Vote ${count}/${mergeVoteCount} succeeded (temp=${temp.toFixed(2)})`,
          );
        } else {
          this.logger?.warn(
            `[Merge] Vote failed (temp=${temp.toFixed(2)}), replacing with a fresh temperature`,
          );
        }
      },
    });

    // One surviving vote can only produce zero-merge consensus (the threshold
    // is 2), so a thin result is useless to merge AND built from the single
    // most error-prone attempt. Bail honestly instead of running a no-op.
    if (votes.length < 2) {
      this.logger?.error(
        `[Merge] Only ${votes.length}/${mergeVoteCount} votes survived — consensus needs 2, returning original characters`,
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
   * Single merge operation with specified temperature using structured outputs.
   * `signal` is the vote-pool controller: aborted once the quota fills, so this
   * request stops mid-flight instead of running to a 4-min timeout nobody reads.
   * One request per temperature — no same-temp retry, the vote pool replaces a
   * failed attempt with a fresh unused temperature.
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    signal: AbortSignal,
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
      corsMiddleware: this.options.mergeConfig?.corsMiddleware ?? this.options.corsMiddleware,
      debugLogger: this.apiClient.debugLogger, // share debugLogger
      logger: this.logger,
    });
    try {
      const response = await client.callStructured({
        messages: mergeMessages,
        schema: MergeSchema,
        schemaName: 'MergeSchema',
        signal,
      });

      // Save first merge phase log
      // savePhaseLog self-dedups to the first call per phase (DebugLogger),
      // so a safe always-call here captures the first successful merge vote.
      await this.apiClient.debugLogger?.savePhaseLog(
        'merge',
        { messages: mergeMessages },
        response,
      );
      return response.merges;
    } catch (error) {
      this.logger?.warn(
        `[Merge] Vote failed (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
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
