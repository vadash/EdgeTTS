// Save Step
// Saves voice mapping JSON to directory
// Audio files are now saved progressively by AudioMergeStep

import { BasePipelineStep, PipelineContext } from '../types';
import { exportToJSONSorted } from '@/services/VoiceMappingService';

/**
 * Options for SaveStep
 */
export interface SaveStepOptions {
  narratorVoice: string;
}

/**
 * Saves voice mapping JSON to the selected directory
 * Audio files are already saved by AudioMergeStep
 */
export class SaveStep extends BasePipelineStep {
  readonly name = 'save';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['assignments', 'characters'];

  constructor(private options: SaveStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { savedFileCount, directoryHandle, characters, voiceMap, assignments, fileNames } = context;

    // Audio files already saved by AudioMergeStep
    this.reportProgress(1, 1, `${savedFileCount ?? 0} audio file(s) saved`);

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

        this.reportProgress(1, 1, `Saved voice mapping: ${bookName}/${fileName}`);
      } catch {
        // Non-fatal error - don't fail the whole save if voice mapping fails
        this.reportProgress(1, 1, 'Warning: Could not save voice mapping');
      }
    }

    this.reportProgress(1, 1, 'Complete');

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
