// Audio Merge Step
// Merges audio chunks into files

import { BasePipelineStep, PipelineContext } from '../types';
import type { IAudioMerger, MergerConfig, IFFmpegService } from '@/services/interfaces';

/**
 * Options for AudioMergeStep
 */
export interface AudioMergeStepOptions {
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  ffmpegService: IFFmpegService;
  createAudioMerger: (config: MergerConfig) => IAudioMerger;
}

/**
 * Merges audio chunks into files
 * Handles FFmpeg loading for Opus encoding
 */
export class AudioMergeStep extends BasePipelineStep {
  readonly name = 'audio-merge';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = [];

  constructor(private options: AudioMergeStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { audioMap, assignments, fileNames } = context;

    if (!audioMap || audioMap.size === 0) {
      this.reportProgress(1, 1, 'No audio to merge');
      return {
        ...context,
        mergedFiles: [],
      };
    }

    // Determine output format
    let useOpus = this.options.outputFormat === 'opus';

    // Load FFmpeg if using Opus
    if (useOpus) {
      this.reportProgress(0, 1, 'Loading FFmpeg for Opus encoding...');

      const loaded = await this.options.ffmpegService.load((msg) => {
        this.reportProgress(0, 1, msg);
      });

      if (!loaded) {
        this.reportProgress(0, 1, 'FFmpeg not available, falling back to MP3');
        useOpus = false;
      }
    }

    this.checkCancelled(signal);

    // Create merger with final config
    const merger = this.options.createAudioMerger({
      outputFormat: useOpus ? 'opus' : 'mp3',
      silenceRemoval: this.options.silenceRemoval,
      normalization: this.options.normalization,
    });

    // Calculate total chunks for progress
    const totalChunks = assignments?.length ?? audioMap.size;

    this.reportProgress(0, totalChunks, 'Merging audio...');

    // Merge audio
    const mergedFiles = await merger.merge(
      audioMap,
      totalChunks,
      fileNames,
      (current, total, message) => {
        this.reportProgress(current, total, message);
      }
    );

    this.reportProgress(totalChunks, totalChunks, `Created ${mergedFiles.length} merged file(s)`);

    return {
      ...context,
      mergedFiles,
    };
  }
}

/**
 * Create an AudioMergeStep
 */
export function createAudioMergeStep(
  options: AudioMergeStepOptions
): AudioMergeStep {
  return new AudioMergeStep(options);
}
