// Speaker Assignment Step
// LLM Assign - Assigns speakers to each sentence

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
 * This is Assign phase of the LLM voice assignment system
 */
export class SpeakerAssignmentStep extends BasePipelineStep {
  readonly name = 'speaker-assignment';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['characters', 'voiceMap'];

  private llmService: ILLMService | null = null;

  constructor(private options: SpeakerAssignmentStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);
    this.validateContext(context);

    this.reportProgress(0, 0, '=== LLM Pass 2: Speaker Assignment ===');

    // After validation, these are guaranteed to exist
    const characters = context.characters!;
    const voiceMap = context.voiceMap!;

    // Create LLM service for this step
    this.llmService = this.options.createLLMService(this.options.llmOptions);

    // Cancel LLM if we get aborted
    const abortHandler = () => this.llmService?.cancel();
    signal.addEventListener('abort', abortHandler);

    try {
      // Split text into blocks for processing
      const blocks = this.options.textBlockSplitter.createAssignBlocks(context.text);

      this.reportProgress(0, blocks.length, `Processing ${blocks.length} block(s)...`);

      // Assign speakers using full character data (with variations)
      const assignments = await this.llmService.assignSpeakers(
        blocks,
        voiceMap,
        characters,
        (current, total) => {
          this.reportProgress(current, total, `Assign: Block ${current}/${total}`);
        }
      );

      this.reportProgress(blocks.length, blocks.length, `Assigned speakers to ${assignments.length} sentence(s)`);

      // Save pipeline state to _temp_work for resume capability
      let tempDirHandle: FileSystemDirectoryHandle | null = null;
      const directoryHandle = context.directoryHandle ?? null;
      if (directoryHandle) {
        try {
          tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work', { create: true });
          const stateFile = await tempDirHandle.getFileHandle('pipeline_state.json', { create: true });
          const writable = await stateFile.createWritable();
          const state = {
            assignments,
            characterVoiceMap: Object.fromEntries(voiceMap),
            fileNames: context.fileNames,
          };
          await writable.write(JSON.stringify(state));
          await writable.close();
          this.reportProgress(blocks.length, blocks.length, 'Saved pipeline state for resume');
        } catch {
          // Non-fatal: resume just won't have LLM cache
        }
      }

      return {
        ...context,
        assignments,
        ...(tempDirHandle && { tempDirHandle }),
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
