// FFmpegService - Handles FFmpeg WASM loading and audio processing
// Provides Opus encoding, silence removal, and normalization

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { defaultConfig } from '@/config';
import type { ILogger, IFFmpegService, AudioProcessingOptions } from './interfaces';

export interface AudioProcessingConfig {
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
}

const CDN_MIRRORS = defaultConfig.ffmpeg.cdnMirrors;

/**
 * FFmpegService - Implements IFFmpegService interface
 * Container-managed singleton (no static getInstance)
 */
export class FFmpegService implements IFFmpegService {
  private ffmpeg: FFmpeg | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private loaded = false;
  private loadError: string | null = null;
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Load FFmpeg WASM from CDN with fallback mirrors
   */
  async load(onProgress?: (message: string) => void): Promise<boolean> {
    if (this.loaded) return true;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.tryLoadFromMirrors(onProgress);
    return this.loadPromise;
  }

  private async tryLoadFromMirrors(onProgress?: (message: string) => void): Promise<boolean> {
    const ffmpeg = new FFmpeg();

    // Set up logging
    ffmpeg.on('log', ({ message }) => {
      this.logger?.debug(`[FFmpeg] ${message}`);
    });

    for (let i = 0; i < CDN_MIRRORS.length; i++) {
      const cdn = CDN_MIRRORS[i];
      onProgress?.(`Loading FFmpeg from CDN ${i + 1}/${CDN_MIRRORS.length}...`);

      try {
        const coreURL = await toBlobURL(
          `${cdn.baseUrl}/${cdn.coreJs}`,
          'text/javascript'
        );
        const wasmURL = await toBlobURL(
          `${cdn.baseUrl}/${cdn.wasmJs}`,
          'application/wasm'
        );

        await ffmpeg.load({ coreURL, wasmURL });
        this.ffmpeg = ffmpeg;
        this.loaded = true;
        this.loadError = null;
        onProgress?.('FFmpeg loaded successfully');
        return true;
      } catch (err) {
        this.logger?.warn(`FFmpeg CDN ${cdn.baseUrl} failed`, { error: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }

    this.loadError = 'All FFmpeg CDN mirrors failed. Using MP3 fallback.';
    onProgress?.(this.loadError);
    return false;
  }

  isAvailable(): boolean {
    return this.loaded && this.ffmpeg !== null;
  }

  getLoadError(): string | null {
    return this.loadError;
  }

  /**
   * Process audio chunks: concatenate, remove silence, normalize, encode to Opus
   */
  async processAudio(
    chunks: Uint8Array[],
    config: AudioProcessingConfig,
    onProgress?: (message: string) => void
  ): Promise<Uint8Array> {
    if (!this.ffmpeg || !this.loaded) {
      throw new Error('FFmpeg not loaded');
    }

    const ffmpeg = this.ffmpeg;

    try {
      // Write all input chunks to virtual filesystem
      onProgress?.('Writing audio chunks to FFmpeg...');
      const inputFiles: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const filename = `input_${i.toString().padStart(5, '0')}.mp3`;
        await ffmpeg.writeFile(filename, chunks[i]);
        inputFiles.push(filename);
      }

      // Generate silence file if needed (for inter-chunk gaps)
      const silenceGapMs = config.silenceGapMs ?? 0;
      let hasSilenceFile = false;
      if (silenceGapMs > 0 && inputFiles.length > 1) {
        onProgress?.(`Generating ${silenceGapMs}ms silence gaps...`);
        await ffmpeg.exec([
          '-f', 'lavfi',
          '-i', `anullsrc=r=${defaultConfig.audio.sampleRate}:cl=mono`,
          '-t', String(silenceGapMs / 1000),
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          'silence.mp3'
        ]);
        hasSilenceFile = true;
      }

      // Create concat file list (with silence interleaved if enabled)
      let concatList: string;
      if (hasSilenceFile) {
        concatList = inputFiles
          .map((f, i) => i < inputFiles.length - 1
            ? `file '${f}'\nfile 'silence.mp3'`
            : `file '${f}'`)
          .join('\n');
      } else {
        concatList = inputFiles.map(f => `file '${f}'`).join('\n');
      }
      await ffmpeg.writeFile('concat.txt', concatList);

      // Build filter chain
      const filters = this.buildFilterChain(config);

      // Build FFmpeg arguments
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
      ];

      if (filters) {
        args.push('-af', filters);
      }

      args.push(
        '-c:a', 'libopus',
        '-b:a', `${defaultConfig.audio.opusBitrate}k`,
        '-compression_level', String(defaultConfig.audio.opusCompression),
        '-ar', String(defaultConfig.audio.sampleRate),
        '-ac', '1',
        '-vbr', 'on',
        'output.opus'
      );

      onProgress?.('Processing audio with FFmpeg...');
      await ffmpeg.exec(args);

      // Read output
      const output = await ffmpeg.readFile('output.opus');

      // Cleanup virtual filesystem
      await this.cleanup(inputFiles);

      return output as Uint8Array;
    } catch (err) {
      // Cleanup on error
      await this.cleanupAll();
      throw new Error(`FFmpeg processing failed: ${(err as Error).message}`);
    }
  }

  private buildFilterChain(config: AudioProcessingConfig): string {
    const filters: string[] = [];

    if (config.silenceRemoval) {
      const audio = defaultConfig.audio;
      filters.push(
        `silenceremove=` +
        `start_periods=${audio.silenceStartPeriods}:` +
        `start_silence=${audio.silenceStartDuration}:` +
        `start_threshold=${audio.silenceThreshold}dB:` +
        `detection=peak:` +
        `stop_periods=${audio.silenceStopPeriods}:` +
        `stop_silence=${audio.silenceStopDuration}:` +
        `stop_threshold=${audio.silenceThreshold}dB`
      );
    }

    if (config.deEss) {
      // Native FFmpeg de-esser filter (available since FFmpeg 4.2)
      // i=intensity (0-1), m=amount of reduction, f=center frequency, s=frequency spread
      filters.push(`deesser=i=0.4:m=0.5:f=0.5:s=0.5`);
    }

    if (config.normalization) {
      const audio = defaultConfig.audio;
      filters.push(
        `loudnorm=` +
        `I=${audio.normLufs}:` +
        `LRA=${audio.normLra}:` +
        `TP=${audio.normTruePeak}`
      );
    }

    return filters.join(',');
  }

  private async cleanup(inputFiles: string[]): Promise<void> {
    if (!this.ffmpeg) return;

    try {
      for (const file of inputFiles) {
        await this.ffmpeg.deleteFile(file);
      }
      await this.ffmpeg.deleteFile('concat.txt');
      await this.ffmpeg.deleteFile('output.opus');
      // Try to delete silence file if it exists
      try {
        await this.ffmpeg.deleteFile('silence.mp3');
      } catch {
        // Ignore - file may not exist
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private async cleanupAll(): Promise<void> {
    if (!this.ffmpeg) return;

    try {
      // Try to clean common files
      const filesToDelete = ['concat.txt', 'output.opus', 'silence.mp3'];
      for (let i = 0; i < 10000; i++) {
        filesToDelete.push(`input_${i.toString().padStart(5, '0')}.mp3`);
      }

      for (const file of filesToDelete) {
        try {
          await this.ffmpeg.deleteFile(file);
        } catch {
          break; // Stop when files don't exist
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Terminate FFmpeg instance to free memory
   */
  terminate(): void {
    if (this.ffmpeg) {
      this.ffmpeg.terminate();
      this.ffmpeg = null;
      this.loaded = false;
      this.loadPromise = null;
    }
  }
}

// Note: No longer exporting a singleton instance
// Use DI container to get the singleton: container.get(ServiceTypes.FFmpegService)
export default FFmpegService;
