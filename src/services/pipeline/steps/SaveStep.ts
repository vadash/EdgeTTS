// Save Step
// Saves merged files to directory

import { BasePipelineStep, PipelineContext } from '../types';
import type { IAudioMerger, MergerConfig } from '@/services/interfaces';

/**
 * Options for SaveStep
 */
export interface SaveStepOptions {
  createAudioMerger: (config: MergerConfig) => IAudioMerger;
}

/**
 * Saves merged files to the selected directory
 */
export class SaveStep extends BasePipelineStep {
  readonly name = 'save';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['mergedFiles'];

  constructor(private options: SaveStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { mergedFiles, directoryHandle } = context;

    if (!mergedFiles || mergedFiles.length === 0) {
      this.reportProgress(1, 1, 'No files to save');
      return context;
    }

    this.reportProgress(0, mergedFiles.length, `Saving ${mergedFiles.length} file(s)...`);

    // Create merger to use its save functionality
    // Note: The merger config doesn't matter for saving, we just need the save method
    const merger = this.options.createAudioMerger({
      outputFormat: 'mp3',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
    });

    await merger.saveMergedFiles(mergedFiles, directoryHandle);

    this.reportProgress(mergedFiles.length, mergedFiles.length, 'Save complete');

    return context;
  }
}

/**
 * Create a SaveStep
 */
export function createSaveStep(
  options: SaveStepOptions
): SaveStep {
  return new SaveStep(options);
}
