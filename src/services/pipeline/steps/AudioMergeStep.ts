// Audio Merge Step
// Merges audio chunks and saves immediately to disk
// Each file is saved as soon as it's merged to minimize RAM

import { BasePipelineStep, PipelineContext } from '../types';
import type { IAudioMerger, MergerConfig, IFFmpegService } from '@/services/interfaces';

/**
 * Options for AudioMergeStep
 */
export interface AudioMergeStepOptions {
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  // Opus encoding settings
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;
  ffmpegService: IFFmpegService;
  createAudioMerger: (config: MergerConfig) => IAudioMerger;
}

/**
 * Merges audio chunks and saves each file immediately to disk
 * Handles FFmpeg loading for Opus encoding
 */
export class AudioMergeStep extends BasePipelineStep {
  readonly name = 'audio-merge';
  protected readonly requiredContextKeys: (keyof PipelineContext)[] = ['audioMap', 'tempDirHandle', 'directoryHandle'];
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['audioMap', 'tempDirHandle', 'failedTasks'];

  constructor(private options: AudioMergeStepOptions) {
    super();
  }

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { audioMap, tempDirHandle, directoryHandle, assignments, fileNames } = context;

    if (!audioMap || audioMap.size === 0) {
      this.reportProgress(1, 1, 'No audio to merge');
      return {
        ...context,
        savedFileCount: 0,
      };
    }

    if (!tempDirHandle) {
      throw new Error('Temp directory handle required for disk-based audio merging');
    }

    if (!directoryHandle) {
      throw new Error('Save directory handle required');
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
        throw new Error('FFmpeg failed to load. Cannot encode to Opus.');
      }
    }

    this.checkCancelled(signal);

    // Create merger with final config
    const merger = this.options.createAudioMerger({
      outputFormat: useOpus ? 'opus' : 'mp3',
      silenceRemoval: this.options.silenceRemoval,
      normalization: this.options.normalization,
      deEss: this.options.deEss,
      silenceGapMs: this.options.silenceGapMs,
      eq: this.options.eq,
      compressor: this.options.compressor,
      fadeIn: this.options.fadeIn,
      stereoWidth: this.options.stereoWidth,
      opusMinBitrate: this.options.opusMinBitrate,
      opusMaxBitrate: this.options.opusMaxBitrate,
      opusCompressionLevel: this.options.opusCompressionLevel,
    });

    // Use audioMap.size: assignments includes filtered-out non-pronounceable
    // entries, but audioMap only contains actually generated audio chunks
    const totalChunks = audioMap.size;

    this.reportProgress(0, totalChunks, 'Merging audio...');

    // Merge and save immediately to disk
    const savedCount = await merger.mergeAndSave(
      audioMap,
      totalChunks,
      fileNames,
      tempDirHandle,
      directoryHandle,
      (current, total, message) => {
        this.reportProgress(current, total, message);
      }
    );

    this.reportProgress(totalChunks, totalChunks, `Saved ${savedCount} file(s)`);

    return {
      ...context,
      savedFileCount: savedCount,
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
