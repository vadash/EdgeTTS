// src/services/llm/stages.ts
// Stage-aware LLM pipeline: a closure factory over per-stage configs (ADR 0015).
// The returned record is the interface; the injected transport is the seam
// (ADR 0014). Cancellation has one channel — the caller's signal on each
// stage call — so there is no stored controller and no cancel().

import { defaultConfig } from '@/config';
import { buildAssignPrompt } from '@/config/prompts/assign/builder';
import {
  formatNumberedParagraphs,
  renumberParagraphs,
  shiftAssignmentKey,
} from '@/config/prompts/shared/numbering';
import { buildExtractPrompt } from '@/config/prompts/extract/builder';
import { buildMergePrompt } from '@/config/prompts/merge/builder';
import { buildQAPrompt } from '@/config/prompts/qa/builder';
import { getErrorMessage } from '@/errors';
import { withRetry } from '@/utils/retry';
import type { LLMCharacter, SpeakerAssignment, StageConfig, TextBlock } from '@/state/types';
import type { ILogger } from '../Logger';
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

export type ProgressCallback = (current: number, total: number, message?: string) => void;

export type { LlmPassId } from './schemaUtils';

/** Per-call controls: the caller's signal is the only cancellation channel. */
export interface StageCall {
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

/**
 * Nested merge/backup stage config: connection triple required, tuning optional.
 */
export type NestedStageConfig = Pick<StageConfig, 'apiKey' | 'apiUrl' | 'model'> &
  Partial<Omit<StageConfig, 'apiKey' | 'apiUrl' | 'model'>>;

/**
 * Resolved client config for one structured-call adapter: exactly the fields
 * an LLMApiClient consumes once stage-config fallbacks have been applied.
 * Exported so an injected transport can switch on the same fields the prod
 * adapter sees (model distinguishes primary/backup/merge stages).
 */
export type LLMClientConfig = LLMApiClientOptions;

export interface LlmStageDeps {
  /** Per-stage raw configs; the module resolves its own adapter slices.
   *  Connection triple required per stage, tuning optional (falls through to
   *  the provider defaults exactly like the old single-stage options bag). */
  extract: NestedStageConfig;
  assign: NestedStageConfig;
  merge: NestedStageConfig;
  /** Optional backup model — used when a stage exhausts maxRetries. */
  backup?: NestedStageConfig | null;
  narratorVoice: string;
  /** Max concurrent LLM requests; also the rate-limit gate ceiling. */
  llmThreads: number;
  /** Gates the Assign QA pass only (ADR 0009). Merge voting is always on. */
  useVoting: boolean;
  directoryHandle: FileSystemDirectoryHandle | null;
  /** Live effective LLM concurrency as the rate-limit gate reacts. */
  onConcurrencyChange?: (effective: number) => void;
  /** Deterministic speaker-code source for tests; defaults to random hex codes. */
  speakerCodeFactory?: () => string;
  /**
   * Transport seam (ADR 0014): routes one structured call through an arbitrary
   * adapter. When present, no LLMApiClient (OpenAI SDK) is constructed — stage
   * tests stub this with canned parsed responses instead of mocking the SDK.
   */
  transport?: <T>(config: LLMClientConfig, opts: StructuredCallOptions<T>) => Promise<T>;
  /** Cross-stage CORS proxy fallback when a stage config omits its own. */
  corsMiddleware?: string;
  logger: ILogger;
}

export interface LlmStages {
  extract(blocks: TextBlock[], p?: StageCall): Promise<LLMCharacter[]>;
  assign(
    blocks: TextBlock[],
    voiceMap: Map<string, string>,
    characters: LLMCharacter[],
    p?: StageCall,
  ): Promise<SpeakerAssignment[]>;
  merge(characters: LLMCharacter[], p?: StageCall): Promise<LLMCharacter[]>;
  testConnection(
    streaming?: boolean,
  ): Promise<{ success: boolean; error?: string; model?: string }>;
}

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
 * Build the extract/assign/merge stage record from its dependencies.
 */
export function createLlmStages(deps: LlmStageDeps): LlmStages {
  const logger = deps.logger;
  const debugLogger = new DebugLogger(deps.directoryHandle, logger);
  const transport = deps.transport;
  const backupConfig = deps.backup ?? null;

  /**
   * Single resolution path for adapter configs: a nested stage config
   * (backup) falls back to its pass's stage config field-by-field, and shared
   * maxTokens/debugLogger/logger are applied uniformly. Callers pin
   * per-request values by composing them into `config` after their spread —
   * merge votes force non-streaming and carry the vote's own temperature.
   */
  const resolveClientConfig = (
    config: NestedStageConfig,
    base?: NestedStageConfig,
  ): LLMClientConfig => ({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    model: config.model,
    streaming: config.streaming ?? base?.streaming,
    reasoning: config.reasoning ?? base?.reasoning,
    temperature: config.temperature ?? base?.temperature,
    topP: config.topP ?? base?.topP,
    maxTokens: defaultConfig.llm.maxTokens,
    corsMiddleware: config.corsMiddleware ?? base?.corsMiddleware ?? deps.corsMiddleware,
    debugLogger,
    logger,
  });

  /** Resolved adapter configs per pass; `call` routes these. */
  const extractClientConfig = resolveClientConfig(deps.extract);
  const assignClientConfig = resolveClientConfig(deps.assign);
  const extractRetries = deps.extract.maxRetries ?? DEFAULT_MAX_RETRIES;
  const assignRetries = deps.assign.maxRetries ?? DEFAULT_MAX_RETRIES;
  const extractBackupClientConfig = backupConfig
    ? resolveClientConfig(backupConfig, deps.extract)
    : null;
  const assignBackupClientConfig = backupConfig
    ? resolveClientConfig(backupConfig, deps.assign)
    : null;

  /** Identical resolved configs share one client (safe: the rate-limit gate is process-global). */
  const clientCache = new Map<string, LLMApiClient>();
  const clientFor = (config: LLMClientConfig): LLMApiClient => {
    const key = JSON.stringify(config);
    let client = clientCache.get(key);
    if (!client) {
      client = new LLMApiClient(config);
      clientCache.set(key, client);
    }
    return client;
  };

  /** Prod OpenAI-SDK adapter — built only when no transport is injected. */
  const apiClient = transport ? undefined : clientFor(extractClientConfig);

  /**
   * Route one structured call: the injected transport when present, otherwise
   * the LLMApiClient adapter for `config`.
   */
  function call<T>(config: LLMClientConfig, opts: StructuredCallOptions<T>): Promise<T> {
    if (transport) return transport(config, opts);
    return clientFor(config).callStructured(opts);
  }

  /**
   * withRetry under a stage's retry budget; the caller shapes the per-attempt
   * log (block indices differ per call site).
   */
  function retryWith<T>(
    budget: number,
    fn: () => Promise<T>,
    signal: AbortSignal | undefined,
    onRetry?: (attempt: number, error: unknown) => void,
  ): Promise<T> {
    return withRetry(fn, { maxRetries: budget, signal, onRetry });
  }

  /**
   * withRetry against the backup client: backup retry budget plus the standard
   * per-attempt warning. `kind` distinguishes whole-block replays from 2-way
   * backup splits in the log.
   */
  function retryBackup<T>(
    pass: 'extract' | 'assign',
    kind: 'retry' | 'split retry',
    fn: () => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const backupRetries = backupConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;
    return withRetry(fn, {
      maxRetries: backupRetries,
      signal,
      onRetry: (attempt, err) => {
        logger.warn(
          `[${pass}] Backup ${kind} ${attempt}/${backupRetries}: ${getErrorMessage(err)}`,
        );
      },
    });
  }

  /**
   * Call structured endpoint for a splittable stage (extract/assign): retry main
   * up to the stage's maxRetries, then fall back to the backup model with its own
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
   * budget, not retries of the same call (see `mergeStage`).
   */
  async function callWithStageBackup<T>(
    pass: 'extract' | 'assign',
    backupClientConfig: LLMClientConfig | null,
    primaryConfig: LLMClientConfig,
    callArgs: StructuredCallOptions<T>,
    primaryRetries: number,
    signal: AbortSignal | undefined,
    onRetry: (attempt: number, error: unknown) => void,
    backup?: () => Promise<T>,
  ): Promise<T> {
    try {
      return await retryWith(primaryRetries, () => call(primaryConfig, callArgs), signal, onRetry);
    } catch (error) {
      // Don't fall back if aborted, or no backup configured
      if (signal?.aborted || !backupConfig || !backupClientConfig) throw error;

      logger.warn(
        `[${pass}] Primary model exhausted ${primaryRetries} retries, falling back to backup model (${backupConfig.model})`,
      );

      // Custom backup path (2-way split) when provided; otherwise replay the
      // identical callArgs against the backup client.
      if (backup) return backup();

      return retryBackup(pass, 'retry', () => call(backupClientConfig, callArgs), signal);
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
  async function extractBackupSplit(
    blockText: string,
    signal: AbortSignal | undefined,
  ): Promise<ExtractResponse> {
    // Drop empty halves so a 1-line block just replays the whole block.
    const halves = splitHalves(blockText).filter((h) => h.length > 0);

    const callHalf = (text: string) => {
      const messages = buildExtractPrompt(text, deps.extract.repeatPrompt ?? false);
      return retryBackup(
        'extract',
        'split retry',
        () =>
          call(extractBackupClientConfig!, {
            messages,
            schema: ExtractSchema,
            schemaName: 'ExtractSchema',
            signal,
            stage: 'extract',
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
  async function assignBackupSplit(
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
        deps.assign.repeatPrompt ?? false,
      );
      return retryBackup(
        'assign',
        'split retry',
        () =>
          call(assignBackupClientConfig!, {
            messages,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal,
            stage: 'assign',
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
    const secondRenumbered = renumberParagraphs(secondLines).join('\n');

    const [first, second] = await Promise.all([callHalf(firstText), callHalf(secondRenumbered)]);

    const merged: Record<string, string> = { ...first.assignments };
    for (const [key, code] of Object.entries(second.assignments)) {
      merged[shiftAssignmentKey(key, offset)] = code;
    }
    return { assignments: merged, reasoning: null };
  }

  /**
   * Extract characters from a single block
   */
  async function extractBlock(
    block: TextBlock,
    index: number,
    total: number,
    signal: AbortSignal | undefined,
  ): Promise<{ characters: LLMCharacter[]; debugLog?: { messages: object; response: object } }> {
    const blockText = block.sentences.join('\n');

    const extractMessages = buildExtractPrompt(blockText, deps.extract.repeatPrompt ?? false);
    try {
      const response = await callWithStageBackup(
        'extract',
        extractBackupClientConfig,
        extractClientConfig,
        {
          messages: extractMessages,
          schema: ExtractSchema,
          schemaName: 'ExtractSchema',
          signal,
          stage: 'extract',
        },
        extractRetries,
        signal,
        (attempt, error) => {
          logger.warn(
            `[Extract] Block ${index + 1}/${total} retry ${attempt}: ${getErrorMessage(error)}`,
          );
        },
        () => extractBackupSplit(blockText, signal),
      );

      // Collect debug log for first block only
      const debugLog = index === 0 ? { messages: extractMessages, response } : undefined;
      return { characters: response.characters, debugLog };
    } catch (error) {
      // Cancellation propagates — never swallow an abort.
      if (signal?.aborted) throw error;
      // Character usually spans more than one block: skip a block that fails
      // main + backup rather than aborting the whole extract pass.
      logger.warn(`[Extract] Block ${index + 1}/${total} failed after all retries, skipping`);
      return { characters: [] };
    }
  }

  /**
   * Parse a sparse assignments object ({"0": "A", "5": "B"}) into a
   * relativeIndex → code map, dropping codes that don't resolve through
   * codeToName so a hallucinated code degrades to narrator downstream.
   */
  function parseAssignments(
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
  async function processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>,
    overlapSentences: string[] | undefined,
    isFirstBlock: boolean,
    signal: AbortSignal | undefined,
  ): Promise<SpeakerAssignment[]> {
    logger.debug?.(
      `[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`,
    );

    // Use 0-based indexing for LLM
    const numberedParagraphs = formatNumberedParagraphs(block.sentences);

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
      deps.assign.repeatPrompt ?? false,
    );

    let relativeMap: Map<number, string>;

    try {
      // Step 1: Always run the initial Assign call
      const draftResponse = await callWithStageBackup(
        'assign',
        assignBackupClientConfig,
        assignClientConfig,
        {
          messages: assignMessages,
          schema: AssignSchema,
          schemaName: 'AssignSchema',
          signal,
          stage: 'assign',
        },
        assignRetries,
        signal,
        (attempt, error) => {
          logger.warn(
            `[assign] Block at ${block.sentenceStartIndex} retry ${attempt}: ${getErrorMessage(error)}`,
          );
        },
        () => assignBackupSplit(context, overlapSentences, signal),
      );

      const draftMap = parseAssignments(draftResponse.assignments, context.codeToName);

      // Save first assign phase log (draft)
      if (isFirstBlock) {
        await debugLogger.savePhaseLog('assign_draft', { messages: assignMessages }, draftResponse);
      }

      // Step 2: If useVoting is enabled, run QA pass
      if (deps.useVoting) {
        const qaMessages = buildQAPrompt(
          context.characters,
          context.nameToCode,
          context.numberedParagraphs,
          draftResponse.assignments,
          overlapSentences,
          deps.assign.repeatPrompt ?? false,
        );

        try {
          // QA retries the PRIMARY only — backup split never activates here. On
          // exhaustion the catch below falls back to draft (DRY with voting-off).
          const qaResponse = await retryWith(
            assignRetries,
            () =>
              call(assignClientConfig, {
                messages: qaMessages,
                schema: AssignSchema,
                schemaName: 'AssignSchema',
                signal,
                stage: 'qa',
              }),
            signal,
            (attempt, error) => {
              logger.warn(
                `[assign] QA pass at ${block.sentenceStartIndex} retry ${attempt}: ${getErrorMessage(error)}`,
              );
            },
          );

          relativeMap = parseAssignments(qaResponse.assignments, context.codeToName);

          // Save QA phase log
          if (isFirstBlock) {
            await debugLogger.savePhaseLog('assign_qa', { messages: qaMessages }, qaResponse);
          }

          logger.info(`[assign] Block at ${block.sentenceStartIndex} completed with QA correction`);
        } catch (qaError) {
          // QA failed - fall back to draft results
          logger.warn(
            `[assign] QA pass failed at ${block.sentenceStartIndex}, using draft: ${getErrorMessage(qaError)}`,
          );
          relativeMap = draftMap;
        }
      } else {
        // No QA pass - use draft directly
        relativeMap = draftMap;
      }
    } catch {
      logger.warn(
        `[assign] Block at ${block.sentenceStartIndex} failed after all retries, using default voice for ${block.sentences.length} sentences`,
      );
      return block.sentences.map((text, i) => ({
        sentenceIndex: block.sentenceStartIndex + i,
        text,
        speaker: 'narrator',
        voiceId: deps.narratorVoice,
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
            ? deps.narratorVoice
            : (characterVoiceMap.get(speaker) ?? deps.narratorVoice),
      };
    });
  }

  /**
   * Single merge operation with specified temperature using structured outputs.
   * `signal` is the vote-pool controller: aborted once the quota fills, so this
   * request stops mid-flight instead of running to a 4-min timeout nobody reads.
   * One request per temperature — no same-temp retry, the vote pool replaces a
   * failed attempt with a fresh unused temperature.
   */
  async function singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    signal: AbortSignal,
  ): Promise<number[][] | null> {
    logger.info(
      `[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`,
    );

    const mergeMessages = buildMergePrompt(characters, deps.merge.repeatPrompt ?? false);

    // Votes never stream, and each carries its own temperature as client-level
    // config — spreadTemps' distinct temps are the voting design (ADR 0008),
    // so each vote temperature resolves its own adapter config; `call`'s
    // per-config cache gives identical configs one shared client instance.
    try {
      const response = await call(
        resolveClientConfig({ ...deps.merge, streaming: false, temperature }, deps.merge),
        {
          messages: mergeMessages,
          schema: MergeSchema,
          schemaName: 'MergeSchema',
          signal,
          stage: 'merge',
        },
      );

      // Save first merge phase log
      // savePhaseLog self-dedups to the first call per phase (DebugLogger),
      // so a safe always-call here captures the first successful merge vote.
      await debugLogger.savePhaseLog('merge', { messages: mergeMessages }, response);
      return response.merges;
    } catch (error) {
      logger.warn(
        `[Merge] Vote failed (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * LLM-based character merge using voting with consensus.
   *
   * `need` votes fire concurrently at distinct temperatures, each with a
   * safety margin of replacement temps so a timed-out attempt is replaced by
   * a fresh temperature instead of retried at the same value. Consensus merges
   * pairs that survive >=2 of the gathered votes.
   */
  async function mergeStage(characters: LLMCharacter[], p?: StageCall): Promise<LLMCharacter[]> {
    const { mergeVoteCount } = defaultConfig.llm;

    // Skip if too few characters
    if (characters.length <= 1) {
      return characters;
    }

    // ponytail: one request per temperature, no same-temp retry. The budget
    // is need × (1 + maxRetries) — the merge stage's maxRetries setting now
    // sizes how many replacement temperatures a dead attempt buys instead of
    // how many times the same dead temperature is re-sent. Capped at 60 because
    // spreadTemps collides above that on the 0.1-0.7 range.
    const maxRetries = deps.merge.maxRetries ?? defaultConfig.llm.maxMergeRetries;
    const budget = Math.min(60, mergeVoteCount * (1 + maxRetries));
    const parallel = Math.min(mergeVoteCount, budget);
    const temps = spreadTemps(budget);

    logger.info(
      `[Merge] Starting ${mergeVoteCount}-way voting merge with ${characters.length} characters (parallel ${Math.min(parallel, temps.length)})`,
    );

    const votes = await collectVotes<number[][]>({
      need: mergeVoteCount,
      parallel,
      temps,
      signal: p?.signal,
      run: (temp, signal) => singleMerge(characters, temp, signal),
      onSettled: (ok, temp, count) => {
        p?.onProgress?.(
          count,
          mergeVoteCount,
          `Merge vote ${count}/${mergeVoteCount} (temp=${temp.toFixed(2)})${ok ? '' : ' failed, replacing'}`,
        );
        if (ok) {
          logger.info(
            `[Merge] Vote ${count}/${mergeVoteCount} succeeded (temp=${temp.toFixed(2)})`,
          );
        } else {
          logger.warn(
            `[Merge] Vote failed (temp=${temp.toFixed(2)}), replacing with a fresh temperature`,
          );
        }
      },
    });

    // One surviving vote can only produce zero-merge consensus (the threshold
    // is 2), so a thin result is useless to merge AND built from the single
    // most error-prone attempt. Bail honestly instead of running a no-op.
    if (votes.length < 2) {
      logger.error(
        `[Merge] Only ${votes.length}/${mergeVoteCount} votes survived — consensus needs 2, returning original characters`,
      );
      return characters;
    }

    // Build consensus from all votes
    const consensusGroups = buildMergeConsensus(votes, logger);
    logger.info(`[Merge] Consensus: ${consensusGroups.length} merges from ${votes.length} votes`);

    // Apply consensus to characters
    const result = applyMergeGroups(characters, consensusGroups);
    logger.info(`[Merge] Final: ${result.length} characters`);

    return result;
  }

  return {
    async extract(blocks: TextBlock[], p?: StageCall): Promise<LLMCharacter[]> {
      logger.info(`[Extract] Starting (${blocks.length} blocks)`);
      const signal = p?.signal;
      apiClient?.resetLogging();

      // Map blocks to task thunks for parallel execution
      const tasks = blocks.map((block, i) => () => extractBlock(block, i, blocks.length, signal));
      const responses = await runWithConcurrency(tasks, {
        concurrency: deps.llmThreads,
        signal: signal ?? null,
        onProgress: (completed, total) => p?.onProgress?.(completed, total),
        onConcurrencyChange: deps.onConcurrencyChange,
      });

      // Collect all characters
      const allCharacters: LLMCharacter[] = [];
      for (const response of responses) {
        allCharacters.push(...response.characters);
      }

      // Save first extract phase log
      if (responses[0]?.debugLog) {
        await debugLogger.savePhaseLog(
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
      logger.info(
        `[Extract] Culled ${beforeCull - merged.length}/${beforeCull} characters by frequency. Remaining: ${merged.length}`,
      );

      // LLM merge if multiple blocks and characters
      if (blocks.length > 1 && merged.length > 1) {
        p?.onProgress?.(blocks.length, blocks.length, `Merging ${merged.length} characters...`);
        merged = await mergeStage(merged, p);
        p?.onProgress?.(blocks.length, blocks.length, `Merged to ${merged.length} characters`);
      }

      return merged;
    },

    async assign(
      blocks: TextBlock[],
      characterVoiceMap: Map<string, string>,
      characters: LLMCharacter[],
      p?: StageCall,
    ): Promise<SpeakerAssignment[]> {
      const signal = p?.signal;
      logger.info(
        `[Assign] Starting (${blocks.length} blocks, max ${deps.llmThreads} concurrent${deps.useVoting ? ', voting enabled' : ''})`,
      );

      // Build code mapping from characters (including variations)
      const { nameToCode, codeToName } = buildCodeMapping(characters, deps.speakerCodeFactory);

      // Build task array for parallel processing
      const tasks = blocks.map((block, globalIndex) => {
        const blockNum = globalIndex + 1;
        return () => {
          const overlapSentences =
            globalIndex > 0 ? blocks[globalIndex - 1].sentences.slice(-OVERLAP_SIZE) : undefined;
          logger.info(`[assign] Starting block ${blockNum}/${blocks.length}`);
          return processAssignBlock(
            block,
            characterVoiceMap,
            characters,
            nameToCode,
            codeToName,
            overlapSentences,
            globalIndex === 0, // isFirstBlock
            signal,
          )
            .then((result) => {
              logger.info(`[assign] Completed block ${blockNum}/${blocks.length}`);
              return result;
            })
            .catch((err) => {
              logger.error(
                `[assign] Error in block ${blockNum}`,
                err instanceof Error ? err : new Error(String(err)),
              );
              throw err;
            });
        };
      });

      // Run all tasks with concurrency control
      const results = await runWithConcurrency(tasks, {
        concurrency: deps.llmThreads,
        signal: signal ?? null,
        onProgress: p?.onProgress,
        onConcurrencyChange: deps.onConcurrencyChange,
      });

      // Flatten and sort by sentence index
      const flatResults = results.flat();
      flatResults.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
      return flatResults;
    },

    merge: mergeStage,

    testConnection(streaming = false) {
      return testLlmConnection(
        {
          config: deps.extract,
          corsMiddleware: deps.corsMiddleware,
          logger,
          transport,
        },
        streaming,
      );
    },
  };
}

/** Connection-probe slice of LlmStageDeps: one stage config plus logging. */
export interface LlmConnectionDeps {
  /** Stage config to probe — connection triple required, tuning optional. */
  config: NestedStageConfig;
  /** Cross-stage CORS proxy fallback when the stage config omits its own. */
  corsMiddleware?: string;
  logger: ILogger;
  /** The transport seam has no SDK client to probe (ADR 0014). */
  transport?: LlmStageDeps['transport'];
}

/**
 * Probe one stage's connection without building a stages record — the UI
 * connection-test path (LLMTab) calls this directly per stage config.
 */
export async function testLlmConnection(
  deps: LlmConnectionDeps,
  streaming = false,
): Promise<{ success: boolean; error?: string; model?: string }> {
  if (deps.transport) return { success: false, error: 'no client' };
  const client = new LLMApiClient({
    apiKey: deps.config.apiKey,
    apiUrl: deps.config.apiUrl,
    model: deps.config.model,
    streaming: deps.config.streaming,
    reasoning: deps.config.reasoning,
    temperature: deps.config.temperature,
    topP: deps.config.topP,
    maxTokens: defaultConfig.llm.maxTokens,
    corsMiddleware: deps.config.corsMiddleware ?? deps.corsMiddleware,
    logger: deps.logger,
  });
  return client.testConnection(streaming);
}
