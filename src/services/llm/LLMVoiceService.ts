import type {
  TextBlock,
  LLMCharacter,
  ExtractResponse,
  SpeakerAssignment,
  MergeResponse,
} from '@/state/types';
import type { ILogger } from '../interfaces';
import { LLMApiClient } from './LLMApiClient';
import { buildExtractPrompt, buildMergePrompt, buildAssignPrompt } from './PromptBuilders';
import { validateExtractResponse, validateMergeResponse, validateAssignResponse, parseAssignResponse } from './ResponseValidators';
import { buildCodeMapping, mergeCharacters, applyMergeResponse } from './CharacterUtils';

export interface LLMVoiceServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger?: ILogger;
}

export interface ProgressCallback {
  (current: number, total: number): void;
}

/**
 * LLMVoiceService - Orchestrates LLM-based character extraction and speaker assignment
 */
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private apiClient: LLMApiClient;
  private abortController: AbortController | null = null;
  private logger?: ILogger;

  constructor(options: LLMVoiceServiceOptions) {
    this.options = options;
    this.logger = options.logger;
    this.apiClient = new LLMApiClient({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
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
      merged = await this.mergeCharactersWithLLM(merged);
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
      const batchPromises = batch.map((block) =>
        this.processAssignBlock(block, characterVoiceMap, characters, nameToCode, codeToName)
      );

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
    const numberedSentences = block.sentences
      .map((s, i) => `[${block.sentenceStartIndex + i}] ${s}`)
      .join('\n');

    const response = await this.apiClient.callWithRetry(
      buildAssignPrompt(characters, nameToCode, numberedSentences, block.sentenceStartIndex),
      (result) => validateAssignResponse(result, block, codeToName),
      this.abortController?.signal,
      [],
      'assign'
    );

    // Parse sparse response and build speaker assignments
    const speakerMap = parseAssignResponse(response, codeToName);

    return block.sentences.map((text, i) => {
      const index = block.sentenceStartIndex + i;
      const speaker = speakerMap.get(index) || 'narrator';
      return {
        sentenceIndex: index,
        text,
        speaker,
        voiceId:
          speaker === 'narrator'
            ? this.options.narratorVoice
            : characterVoiceMap.get(speaker) ?? this.options.narratorVoice,
      };
    });
  }

  /**
   * LLM-based character merge to deduplicate characters with different canonical names
   */
  private async mergeCharactersWithLLM(characters: LLMCharacter[]): Promise<LLMCharacter[]> {
    this.logger?.info(`[Merge] Starting character deduplication (${characters.length} characters)`);
    const response = await this.apiClient.callWithRetry(
      buildMergePrompt(characters),
      (result) => validateMergeResponse(result, characters),
      this.abortController?.signal,
      [],
      'merge'
    );

    const parsed = JSON.parse(response) as MergeResponse;
    return applyMergeResponse(characters, parsed);
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.apiClient.testConnection();
  }
}
