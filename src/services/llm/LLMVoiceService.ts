import type {
  TextBlock,
  LLMCharacter,
  ExtractResponse,
  SpeakerAssignment,
  MergeResponse,
} from '@/state/types';
import type { ILogger, ProgressCallback } from '../interfaces';
import { LLMApiClient } from './LLMApiClient';
import { buildExtractPrompt, buildMergePrompt, buildAssignPrompt } from './PromptBuilders';
import { validateExtractResponse, validateMergeResponse, validateAssignResponse, parseAssignResponse, fixMergeResponse } from './ResponseValidators';
import { buildCodeMapping, mergeCharacters, applyMergeResponse, normalizeCanonicalNames } from './CharacterUtils';

/**
 * Regex matching speech/dialogue symbols:
 * " - Double quote
 * « » - Guillemets
 * ‹ › - Single guillemets
 * — - Em dash
 * " " - Curly double quotes
 * „ - Low double quote
 * ' ' ' - Single quotes (straight and curly)
 */
export const SPEECH_SYMBOLS_REGEX = /["\u00AB\u00BB\u2014\u201C\u201D\u201E\u2039\u203A'\u2018\u2019]/;

export interface LLMVoiceServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger: ILogger; // Required - prevents silent failures
}

/**
 * LLMVoiceService - Orchestrates LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private apiClient: LLMApiClient;
  private abortController: AbortController | null = null;
  private logger: ILogger;

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

      const response = await this.apiClient.callWithRetry(
        buildExtractPrompt(blockText),
        validateExtractResponse,
        this.abortController.signal,
        [],
        'extract'
      );

      const parsed = JSON.parse(response) as ExtractResponse;
      allCharacters.push(...parsed.characters);
    }

    // Simple merge by canonicalName first
    let merged = mergeCharacters(allCharacters);

    // LLM merge only if multiple blocks were processed and multiple characters exist
    if (blocks.length > 1 && merged.length > 1) {
      // Normalize canonicalNames to longest variation before merge (prevents LLM picking variation names)
      const normalized = normalizeCanonicalNames(merged);
      onProgress?.(blocks.length, blocks.length, `Merging ${normalized.length} characters...`);
      merged = await this.mergeCharactersWithLLM(normalized, onProgress);
      onProgress?.(blocks.length, blocks.length, `Merged to ${merged.length} characters`);
    }

    return merged;
  }

  /**
   * Assign: Assign speakers to sentences (parallel, up to 20 concurrent)
   */
  async assignSpeakers(
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<SpeakerAssignment[]> {
    this.logger?.info(`[Assign] Starting (${blocks.length} blocks)`);
    const MAX_CONCURRENT = 20;
    const results: SpeakerAssignment[] = [];
    let completed = 0;

    this.abortController = new AbortController();

    // Build code mapping from characters (including variations)
    const { nameToCode, codeToName } = buildCodeMapping(characters);

    // Process blocks in batches
    for (let i = 0; i < blocks.length; i += MAX_CONCURRENT) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const batch = blocks.slice(i, i + MAX_CONCURRENT);
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
    const hasSpeech = block.sentences.some(p => SPEECH_SYMBOLS_REGEX.test(p));

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

    const response = await this.apiClient.callWithRetry(
      buildAssignPrompt(characters, nameToCode, numberedParagraphs, 0),
      (result) => validateAssignResponse(result, block.sentences.length, codeToName),
      this.abortController?.signal,
      [],
      'assign'
    );

    // Parse response (0-based) and map back to absolute indices
    const relativeMap = parseAssignResponse(response, codeToName);

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const relativeIndex = i; // 0-based
      const hasSpeechSymbols = SPEECH_SYMBOLS_REGEX.test(text);
      const speaker = hasSpeechSymbols ? (relativeMap.get(relativeIndex) || 'narrator') : 'narrator';
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
   * LLM-based character merge to deduplicate characters with different canonical names
   */
  private async mergeCharactersWithLLM(
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    this.logger?.info(`[Merge] Starting character deduplication (${characters.length} characters)`);
    const response = await this.apiClient.callWithRetry(
      buildMergePrompt(characters),
      (result) => validateMergeResponse(result, characters),
      this.abortController?.signal,
      [],
      'merge',
      (attempt, delay, errors) => {
        const errorCount = errors?.length || 0;
        const reason = errorCount ? ` (${errorCount} errors): ${errors![errors!.length - 1]}` : '';
        onProgress?.(0, 0, `Merge validation failed${reason}, retry ${attempt} in ${Math.round(delay / 1000)}s...`);
      }
    );

    // Fix response by auto-adding any missing characters to unchanged list
    const fixedResponse = fixMergeResponse(response, characters);
    const parsed = JSON.parse(fixedResponse) as MergeResponse;
    return applyMergeResponse(characters, parsed);
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string; model?: string }> {
    return this.apiClient.testConnection();
  }
}
