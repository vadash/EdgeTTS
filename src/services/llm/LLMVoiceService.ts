import type {
  LLMCharacter,
  ReasoningLevel,
  SpeakerAssignment,
  StageConfig,
  TextBlock,
} from '@/state/types';
import type { ILogger } from '../Logger';

export type ProgressCallback = (current: number, total: number, message?: string) => void;

import { defaultConfig } from '@/config';
import { buildAssignPrompt } from '@/config/prompts/assign/builder';
import { buildExtractPrompt } from '@/config/prompts/extract/builder';
import { buildMergePrompt } from '@/config/prompts/merge/builder';
import { buildQAPrompt } from '@/config/prompts/qa/builder';
import { getErrorMessage } from '@/errors';
import { withRetry } from '@/utils/retry';
import {
  type AssignContext,
  applyMergeGroups,
  buildCodeMapping,
  cullByFrequency,
  mergeCharacters as dedupeCharacters,
} from './CharacterUtils';
import { collectVotes, spreadTemps } from './collectVotes';
import { DebugLogger } from './DebugLogger';
import { LLMApiClient, type LLMApiClientOptions } from './LLMApiClient';
import { runWithConcurrency } from './runWithConcurrency';
import {
  type AssignResponse,
  AssignSchema,
  type ExtractResponse,
  ExtractSchema,
  MergeSchema,
} from './schemas';
import type { StructuredCallOptions } from './schemaUtils';
import { buildMergeConsensus } from './votingConsensus';

/**
 * Number of sentences from the previous block to pass as overlap context
 */
const OVERLAP_SIZE = 10;

const DEFAULT_MAX_RETRIES = 3;

/**
 * Split text into two halves at the balanced line boundary (first half takes
 * the extra line). A single-line block yields an empty second half, which
 * callers treat as "replay the whole block".
 */
function splitHalves(text: string): [string[], string[]] {
  const lines = text.split('\n');
  const mid = Math.ceil(lines.length / 2);
  return [lines.slice(0, mid), lines.slice(mid)];
}

/**
 * Nested merge/backup stage config: connection triple required, tuning optional.
 */
type NestedStageConfig = Pick<StageConfig, 'apiKey' | 'apiUrl' | 'model'> &
  Partial<Omit<StageConfig, 'apiKey' | 'apiUrl' | 'model'>>;

/**
 * Resolved client config for one structured-call adapter: exactly the fields
 * an LLMApiClient consumes once stage-config fallbacks have been applied.
 * Exported so an injected transport can switch on the same fields the prod
 * adapter sees (model distinguishes primary/backup/merge stages).
 */
export type LLMClientConfig = LLMApiClientOptions;

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
  reasoning?: ReasoningLevel | null;
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
  // Optional separate config for merge stage
  mergeConfig?: NestedStageConfig;
  /** Optional backup model — used when this stage exhausts maxRetries */
  backupConfig?: NestedStageConfig;
  /**
   * Transport seam: routes one structured call through an arbitrary adapter.
   * When present, no LLMApiClient (OpenAI SDK) is constructed — stage tests
   * stub this with canned parsed responses instead of mocking the SDK.
   */
  transport?: <T>(config: LLMClientConfig, opts: StructuredCallOptions<T>) => Promise<T>;
  /** Deterministic speaker-code source for tests; defaults to random hex codes. */
  speakerCodeFactory?: () => string;
}

/**
 * LLMVoiceService - Orchestrates LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private logger: ILogger;
  private debugLogger: DebugLogger;
  /** Resolved per-stage adapter configs; `call` routes these. */
  private primaryConfig: LLMClientConfig;
  private backupConfig: NestedStageConfig | null;
  private backupClientConfig: LLMClientConfig | null;
  /** Prod OpenAI-SDK adapters — built only when no transport is injected. */
  private apiClient: LLMApiClient | undefined;
  private backupApiClient: LLMApiClient | null = null;
  /** Identical resolved configs share one client (safe: the rate-limit gate is process-global). */
  private clientCache = new Map<string, LLMApiClient>();
  private abortController: AbortController | null = null;

  constructor(options: LLMVoiceServiceOptions) {
    if (!options.logger) {
      throw new Error('LLMVoiceService requires a logger');
    }
    this.options = options;
    this.logger = options.logger;
    this.debugLogger = new DebugLogger(options.directoryHandle, options.logger);
    this.backupConfig = options.backupConfig ?? null;
    this.backupClientConfig = options.backupConfig
      ? this.resolveClientConfig(options.backupConfig)
      : null;
    this.primaryConfig = this.resolveClientConfig(options);
    if (!options.transport) {
      // Prod adapter: one primary + one backup client, as before the seam.
      this.backupApiClient = this.backupClientConfig
        ? new LLMApiClient(this.backupClientConfig)
        : null;
      this.apiClient = new LLMApiClient(this.primaryConfig);
      this.clientCache.set(JSON.stringify(this.primaryConfig), this.apiClient);
      if (this.backupApiClient) {
        this.clientCache.set(JSON.stringify(this.backupClientConfig!), this.backupApiClient);
      }
    }
  }

  /**
   * Single resolution path for this service's adapter configs: a stage config
   * (backup/merge) falls back to the main options field-by-field, and shared
   * maxTokens/debugLogger/logger are applied uniformly. Callers pin
   * per-request values by composing them into `config` after their spread —
   * merge votes force non-streaming and carry the vote's own temperature.
   */
  private resolveClientConfig(
    config: Pick<
      LLMVoiceServiceOptions,
      | 'apiKey'
      | 'apiUrl'
      | 'model'
      | 'streaming'
      | 'reasoning'
      | 'temperature'
      | 'topP'
      | 'corsMiddleware'
    >,
  ): LLMClientConfig {
    return {
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      model: config.model,
      streaming: config.streaming ?? this.options.streaming,
      reasoning: config.reasoning ?? this.options.reasoning,
      temperature: config.temperature ?? this.options.temperature,
      topP: config.topP ?? this.options.topP,
      maxTokens: defaultConfig.llm.maxTokens,
      corsMiddleware: config.corsMiddleware ?? this.options.corsMiddleware,
      debugLogger: this.debugLogger,
      logger: this.options.logger,
    };
  }

  /**
   * Route one structured call: the injected transport when present, otherwise
   * the LLMApiClient adapter for `config`. Clients are cached by resolved
   * config, so repeated identical configs (e.g. merge votes at the same
   * temperature) share one instance — safe because the rate-limit gate is
   * process-global, not per client (ADR 0012).
   */
  private call<T>(config: LLMClientConfig, opts: StructuredCallOptions<T>): Promise<T> {
    const transport = this.options.transport;
    if (transport) return transport(config, opts);
    const key = JSON.stringify(config);
    let client = this.clientCache.get(key);
    if (!client) {
      client = new LLMApiClient(config);
      this.clientCache.set(key, client);
    }
    return client.callStructured(opts);
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
   * withRetry with the primary model's retry budget; the caller shapes the
   * per-attempt log (block indices differ per call site).
   */
  private retryPrimary<T>(
    fn: () => Promise<T>,
    signal: AbortSignal | undefined,
    onRetry: (attempt: number, error: unknown) => void,
  ): Promise<T> {
    return withRetry(fn, {
      maxRetries: this.options.maxRetries ?? DEFAULT_MAX_RETRIES,
      signal,
      onRetry,
    });
  }

  /**
   * withRetry against the backup client: backup retry budget plus the standard
   * per-attempt warning. `kind` distinguishes whole-block replays from 2-way
   * backup splits in the log.
   */
  private retryBackup<T>(
    stage: string,
    kind: 'retry' | 'split retry',
    fn: () => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const backupRetries = this.options.backupConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
    return withRetry(fn, {
      maxRetries: backupRetries,
      signal,
      onRetry: (attempt, err) => {
        this.logger?.warn(
          `[${stage}] Backup ${kind} ${attempt}/${backupRetries}: ${getErrorMessage(err)}`,
        );
      },
    });
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
   * budget, not retries of the same call (see `mergeCharacters`).
   */
  private async callWithStageBackup<T>(
    stage: 'extract' | 'assign',
    primaryConfig: LLMClientConfig,
    callArgs: StructuredCallOptions<T>,
    signal: AbortSignal | undefined,
    onRetry: (attempt: number, error: unknown) => void,
    backup?: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;

    try {
      return await this.retryPrimary(() => this.call(primaryConfig, callArgs), signal, onRetry);
    } catch (error) {
      // Don't fall back if aborted, or no backup configured
      if (signal?.aborted || !this.backupConfig) throw error;

      this.logger?.warn(
        `[${stage}] Primary model exhausted ${maxRetries} retries, falling back to backup model (${this.backupConfig.model})`,
      );

      // Custom backup path (2-way split) when provided; otherwise replay the
      // identical callArgs against the backup client.
      if (backup) return backup();

      return this.retryBackup(
        stage,
        'retry',
        () => this.call(this.backupClientConfig!, callArgs),
        signal,
      );
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
    // Drop empty halves so a 1-line block just replays the whole block.
    const halves = splitHalves(blockText).filter((h) => h.length > 0);

    const callHalf = (text: string) => {
      const messages = buildExtractPrompt(text, this.options.repeatPrompt ?? false);
      return this.retryBackup(
        'extract',
        'split retry',
        () =>
          this.call(this.backupClientConfig!, {
            messages,
            schema: ExtractSchema,
            schemaName: 'ExtractSchema',
            signal,
          }),
        signal,
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
    const [firstLines, secondHalf] = splitHalves(context.numberedParagraphs);
    const secondLines = secondHalf.filter((l) => l.length > 0);
    const offset = firstLines.length;

    const callHalf = (numberedParagraphs: string) => {
      const messages = buildAssignPrompt(
        context.characters,
        context.nameToCode,
        numberedParagraphs,
        overlapSentences,
        this.options.repeatPrompt ?? false,
      );
      return this.retryBackup(
        'assign',
        'split retry',
        () =>
          this.call(this.backupClientConfig!, {
            messages,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal,
          }),
        signal,
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
    this.apiClient?.resetLogging();

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
      await this.debugLogger?.savePhaseLog(
        'extract',
        { messages: responses[0].debugLog.messages },
        responses[0].debugLog.response,
      );
    }

    // Simple merge by canonicalName
    let merged = dedupeCharacters(allCharacters);

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
      merged = await this.mergeCharacters(merged, onProgress);
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

    const extractMessages = buildExtractPrompt(blockText, this.options.repeatPrompt ?? false);
    try {
      const response = await this.callWithStageBackup(
        'extract',
        this.primaryConfig,
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
    const { nameToCode, codeToName } = buildCodeMapping(
      characters,
      this.options.speakerCodeFactory,
    );

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
   * Parse a sparse assignments object ({"0": "A", "5": "B"}) into a
   * relativeIndex → code map, dropping codes that don't resolve through
   * codeToName so a hallucinated code degrades to narrator downstream.
   */
  private parseAssignments(
    assignments: Record<string, string>,
    codeToName: Map<string, string>,
  ): Map<number, string> {
    const map = new Map<number, string>();
    for (const [key, code] of Object.entries(assignments)) {
      const index = parseInt(key, 10);
      if (codeToName.has(code)) {
        map.set(index, code);
      }
    }
    return map;
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
      overlapSentences,
      this.options.repeatPrompt ?? false,
    );

    let relativeMap: Map<number, string>;

    try {
      // Step 1: Always run the initial Assign call
      const draftResponse = await this.callWithStageBackup(
        'assign',
        this.primaryConfig,
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

      const draftMap = this.parseAssignments(draftResponse.assignments, context.codeToName);

      // Save first assign phase log (draft)
      if (isFirstBlock) {
        await this.debugLogger?.savePhaseLog(
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
          overlapSentences,
          this.options.repeatPrompt ?? false,
        );

        try {
          // QA retries the PRIMARY only — backup split never activates here. On
          // exhaustion the catch below falls back to draft (DRY with voting-off).
          const qaResponse = await this.retryPrimary(
            () =>
              this.call(this.primaryConfig, {
                messages: qaMessages,
                schema: AssignSchema,
                schemaName: 'AssignSchema',
                signal: this.abortController?.signal,
              }),
            this.abortController?.signal,
            (attempt, error) => {
              this.logger?.warn(
                `[assign] QA pass at ${block.sentenceStartIndex} retry ${attempt}: ${getErrorMessage(error)}`,
              );
            },
          );

          relativeMap = this.parseAssignments(qaResponse.assignments, context.codeToName);

          // Save QA phase log
          if (isFirstBlock) {
            await this.debugLogger?.savePhaseLog('assign_qa', { messages: qaMessages }, qaResponse);
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
  async mergeCharacters(
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
      this.options.mergeConfig?.repeatPrompt ?? false,
    );

    // Votes never stream, and each carries its own temperature as client-level
    // config — spreadTemps' distinct temps are the voting design (ADR 0008),
    // so each vote temperature resolves its own adapter config; `call`'s
    // per-config cache gives identical configs one shared client instance.
    const stage = this.options.mergeConfig ?? this.options;
    try {
      const response = await this.call(
        this.resolveClientConfig({ ...stage, streaming: false, temperature }),
        {
          messages: mergeMessages,
          schema: MergeSchema,
          schemaName: 'MergeSchema',
          signal,
        },
      );

      // Save first merge phase log
      // savePhaseLog self-dedups to the first call per phase (DebugLogger),
      // so a safe always-call here captures the first successful merge vote.
      await this.debugLogger?.savePhaseLog('merge', { messages: mergeMessages }, response);
      return response.merges;
    } catch (error) {
      this.logger?.warn(
        `[Merge] Vote failed (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Test API connection (streaming/SSE endpoint when requested)
   */
  async testConnection(
    streaming = false,
  ): Promise<{ success: boolean; error?: string; model?: string }> {
    // The transport seam has no SDK client to probe.
    if (!this.apiClient) return { success: false, error: 'no client' };
    return this.apiClient.testConnection(streaming);
  }
}

// Type alias for DI factory compatibility
export type LLMServiceFactoryOptions = LLMVoiceServiceOptions;
