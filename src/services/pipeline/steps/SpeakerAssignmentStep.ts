// Speaker Assignment Step
// LLM Pass 2 - Assigns speakers to each sentence

import { BasePipelineStep, PipelineContext } from '../types';
import type { ILLMService, ITextBlockSplitter, LLMServiceFactoryOptions } from '@/services/interfaces';

/**
 * Options for SpeakerAssignmentStep
 */
export interface SpeakerAssignmentStepOptions {
  llmOptions: LLMServiceFactoryOptions;
  createLLMService: (options: LLMServiceFactoryOptions) => ILLMService;
  textBlockSplitter: ITextBlockSplitter;
}

/**
 * Assigns speakers to sentences using LLM
 * This is Pass 2 of the LLM voice assignment system
 */
export class SpeakerAssignmentStep extends BasePipelineStep {
  readonly name = 'speaker-assignment';

  private llmService: ILLMService | null = null;

  constructor(private options: SpeakerAssignmentStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { characters, voiceMap } = context;

    if (!characters || !voiceMap) {
      throw new Error('SpeakerAssignmentStep requires characters and voiceMap from previous steps');
    }

    // Create LLM service for this step
    this.llmService = this.options.createLLMService(this.options.llmOptions);

    // Cancel LLM if we get aborted
    const abortHandler = () => this.llmService?.cancel();
    signal.addEventListener('abort', abortHandler);

    try {
      // Split text into blocks for processing
      const blocks = this.options.textBlockSplitter.createPass2Blocks(context.text);

      this.reportProgress(0, blocks.length, `Processing ${blocks.length} block(s)...`);

      // Get canonical names from characters
      const canonicalNames = characters.map(c => c.canonicalName);

      // Assign speakers
      const assignments = await this.llmService.assignSpeakers(
        blocks,
        voiceMap,
        canonicalNames,
        (current, total) => {
          this.reportProgress(current, total, `Pass 2: Block ${current}/${total}`);
        }
      );

      this.reportProgress(blocks.length, blocks.length, `Assigned speakers to ${assignments.length} sentence(s)`);

      return {
        ...context,
        assignments,
      };
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Create a SpeakerAssignmentStep
 */
export function createSpeakerAssignmentStep(
  options: SpeakerAssignmentStepOptions
): SpeakerAssignmentStep {
  return new SpeakerAssignmentStep(options);
}
