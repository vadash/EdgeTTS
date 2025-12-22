// Save Step
// Saves merged files and voice mapping to directory

import { BasePipelineStep, PipelineContext } from '../types';
import type { IAudioMerger, MergerConfig } from '@/services/interfaces';
import { exportToJSONSorted } from '@/services/VoiceMappingService';

/**
 * Options for SaveStep
 */
export interface SaveStepOptions {
  createAudioMerger: (config: MergerConfig) => IAudioMerger;
  narratorVoice: string;
}

/**
 * Saves merged files and voice mapping to the selected directory
 */
export class SaveStep extends BasePipelineStep {
  readonly name = 'save';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['mergedFiles', 'assignments', 'characters'];

  constructor(private options: SaveStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { mergedFiles, directoryHandle, characters, voiceMap, assignments, fileNames } = context;

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
      silenceGapMs: 0,
    });

    await merger.saveMergedFiles(mergedFiles, directoryHandle);

    // Save voice mapping JSON if we have character data and a directory
    if (directoryHandle && characters && voiceMap && assignments) {
      try {
        const bookName = this.extractBookName(fileNames);
        // Create/get book subfolder
        const bookFolder = await directoryHandle.getDirectoryHandle(bookName, { create: true });
        // Export with sorted and filtered voices
        const json = exportToJSONSorted(characters, voiceMap, assignments, this.options.narratorVoice);
        const fileName = `${bookName}.json`;

        const fileHandle = await bookFolder.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();

        this.reportProgress(0, 0, `Saved voice mapping: ${bookName}/${fileName}`);
      } catch {
        // Non-fatal error - don't fail the whole save if voice mapping fails
        this.reportProgress(0, 0, 'Warning: Could not save voice mapping');
      }
    }

    this.reportProgress(mergedFiles.length, mergedFiles.length, 'Save complete');

    return context;
  }

  /**
   * Extract book name from fileNames for the JSON filename
   */
  private extractBookName(fileNames?: Array<[string, number]>): string {
    if (!fileNames || fileNames.length === 0) {
      return 'book';
    }
    // Get the first filename and clean it up
    const [name] = fileNames[0];
    // Remove extension and clean
    return name.replace(/\.[^.]+$/, '').slice(0, 50) || 'book';
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
