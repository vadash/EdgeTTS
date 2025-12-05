// Character Extraction Step
// LLM Extract - Extracts characters from text blocks

import { BasePipelineStep, PipelineContext } from '../types';
import type { ILLMService, ITextBlockSplitter, LLMServiceFactoryOptions } from '@/services/interfaces';

/**
 * Options for CharacterExtractionStep
 */
export interface CharacterExtractionStepOptions {
  llmOptions: LLMServiceFactoryOptions;
  createLLMService: (options: LLMServiceFactoryOptions) => ILLMService;
  textBlockSplitter: ITextBlockSplitter;
}

/**
 * Extracts characters from text using LLM
 * This is Extract phase of the LLM voice assignment system
 */
export class CharacterExtractionStep extends BasePipelineStep {
  readonly name = 'character-extraction';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];

  private llmService: ILLMService | null = null;

  constructor(private options: CharacterExtractionStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    this.reportProgress(0, 0, '=== LLM Pass 1: Character Extraction ===');

    // Create LLM service for this step
    this.llmService = this.options.createLLMService(this.options.llmOptions);

    // Cancel LLM if we get aborted
    const abortHandler = () => this.llmService?.cancel();
    signal.addEventListener('abort', abortHandler);

    try {
      // Split text into blocks for processing
      const blocks = this.options.textBlockSplitter.createExtractBlocks(context.text);

      this.reportProgress(0, blocks.length, `Processing ${blocks.length} block(s)...`);

      // Extract characters
      const characters = await this.llmService.extractCharacters(blocks, (current, total) => {
        this.reportProgress(current, total, `Extract: Block ${current}/${total}`);
      });

      this.reportProgress(blocks.length, blocks.length, `Detected ${characters.length} character(s)`);

      return {
        ...context,
        characters,
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Create a CharacterExtractionStep
 */
export function createCharacterExtractionStep(
  options: CharacterExtractionStepOptions
): CharacterExtractionStep {
  return new CharacterExtractionStep(options);
}
