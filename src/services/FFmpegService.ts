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
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  // Opus encoding settings (optional, uses defaults if not provided)
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;
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
  private operationCount = 0;
  private readonly MAX_OPERATIONS_BEFORE_REFRESH = 10;

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
   * Null entries in chunks array are replaced with silence placeholders
   */
  async processAudio(
    chunks: (Uint8Array | null)[],
    config: AudioProcessingConfig,
    onProgress?: (message: string) => void
  ): Promise<Uint8Array> {
    // Proactively refresh FFmpeg to prevent WASM memory exhaustion after many operations
    if (this.operationCount >= this.MAX_OPERATIONS_BEFORE_REFRESH) {
      this.logger?.debug(`FFmpeg: Proactive refresh after ${this.operationCount} operations`);
      this.terminate();
    }

    // Reload if needed (after termination or if not loaded)
    if (!this.ffmpeg || !this.loaded) {
      const loaded = await this.load(onProgress);
      if (!loaded) {
        throw new Error('FFmpeg failed to load');
      }
    }

    this.operationCount++;

    // Safe to assert non-null: load() returning true guarantees ffmpeg is set
    const ffmpeg = this.ffmpeg!;
    // Track files written to cleanup later
    const inputFiles: (string | null)[] = [];

    try {
      // Generate silence file upfront (for gaps and missing chunk placeholders)
      const silenceGapMs = config.silenceGapMs ?? 200; // Default 200ms for missing chunks
      const hasMissingChunks = chunks.some(c => c === null);
      const needsGaps = silenceGapMs > 0 && chunks.filter(c => c !== null).length > 1;

      if (hasMissingChunks || needsGaps) {
        onProgress?.(`Generating ${silenceGapMs}ms silence...`);
        await ffmpeg.exec([
          '-f', 'lavfi',
          '-i', `anullsrc=r=${defaultConfig.audio.sampleRate}:cl=mono`,
          '-t', String(silenceGapMs / 1000),
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          'silence.mp3'
        ]);
      }

      // Write all input chunks to virtual filesystem
      onProgress?.('Writing audio chunks to FFmpeg...');
      let actualFileIndex = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i] !== null) {
          const filename = `input_${actualFileIndex.toString().padStart(5, '0')}.mp3`;
          await ffmpeg.writeFile(filename, chunks[i]!);
          inputFiles.push(filename);
          actualFileIndex++;
        } else {
          // Mark position as missing - will use silence
          inputFiles.push(null);
        }
      }

      // Create concat file list (with silence for gaps and missing chunks)
      const concatLines: string[] = [];
      const actualFiles = inputFiles.filter(f => f !== null);
      let actualFileIdx = 0;

      for (let i = 0; i < inputFiles.length; i++) {
        if (inputFiles[i] !== null) {
          concatLines.push(`file '${inputFiles[i]}'`);
          // Add gap silence after chunk (except last)
          if (needsGaps && actualFileIdx < actualFiles.length - 1) {
            concatLines.push(`file 'silence.mp3'`);
          }
          actualFileIdx++;
        } else {
          // Missing chunk - insert silence placeholder
          concatLines.push(`file 'silence.mp3'`);
        }
      }

      await ffmpeg.writeFile('concat.txt', concatLines.join('\n'));

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
        '-ac', config.stereoWidth ? '2' : '1',
        '-vbr', 'on',
        'output.opus'
      );

      onProgress?.('Processing audio with FFmpeg...');
      await ffmpeg.exec(args);

      // Read output
      const output = await ffmpeg.readFile('output.opus');

      // Cleanup virtual filesystem (only actual files, not null placeholders)
      await this.cleanup(inputFiles.filter((f): f is string => f !== null));

      return output as Uint8Array;
    } catch (err) {
      // Cleanup on error - be aggressive
      const writtenFiles = inputFiles.filter((f): f is string => f !== null);

      try {
        await this.cleanup(writtenFiles);
        if (writtenFiles.length === 0) {
          await this.cleanupAll();
        }
      } catch (cleanupErr) {
        this.logger?.warn(`FFmpeg cleanup failed during error handling: ${String(cleanupErr)}`);
      }

      // Terminate the instance as it's likely corrupted or OOM
      // This forces isAvailable() to return false, ensuring clean fallback to MP3
      this.terminate();

      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`FFmpeg processing failed: ${errorMessage}`);
    }
  }

  private buildFilterChain(config: AudioProcessingConfig): string {
    const filters: string[] = [];
    const audio = defaultConfig.audio;

    // 1. EQ — Broadcast Voice warmth & clarity
    if (config.eq) {
      filters.push(
        'highpass=f=60',
        'lowshelf=f=120:g=2',
        'equalizer=f=3000:t=q:w=1:g=-2'
      );
    }

    // 2. De-Ess
    if (config.deEss) {
      filters.push('deesser=i=0.4:m=0.5:f=0.5:s=0.5');
    }

    // 3. Silence Removal
    if (config.silenceRemoval) {
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

    // 4. Compressor — gentle vocal compression
    if (config.compressor) {
      filters.push(
        'compand=attacks=0.1:decays=0.8:points=-90/-90|-50/-50|-30/-30|-20/-20:soft-knee=6:gain=0'
      );
    }

    // 5. Normalization + 6. Limiter (auto with normalization)
    if (config.normalization) {
      filters.push(
        `loudnorm=` +
        `I=${audio.normLufs}:` +
        `LRA=${audio.normLra}:` +
        `TP=${audio.normTruePeak}:` +
        `dual_mono=true`
      );
      // Limiter always follows normalization
      filters.push(
        'alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=0:asc_level=0'
      );
    }

    // 7. Fade-In
    if (config.fadeIn) {
      filters.push('afade=t=in:ss=0:d=0.1');
    }

    // 8. Stereo Width (pseudo-stereo)
    if (config.stereoWidth) {
      filters.push('aecho=0.8:0.88:10:0.3');
    }

    return filters.join(',');
  }

  /**
   * Cleanup specific files robustly (ignores errors)
   */
  private async cleanup(inputFiles: string[]): Promise<void> {
    if (!this.ffmpeg) return;

    // 1. Delete input files
    for (const file of inputFiles) {
      try {
        await this.ffmpeg.deleteFile(file);
      } catch {
        // Ignore delete errors, file might not exist
      }
    }

    // 2. Delete common temp files
    const tempFiles = ['concat.txt', 'output.opus', 'silence.mp3'];
    for (const file of tempFiles) {
      try {
        await this.ffmpeg.deleteFile(file);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Bruteforce cleanup when specific filenames are unknown
   */
  private async cleanupAll(): Promise<void> {
    if (!this.ffmpeg) return;

    // Common files
    const filesToDelete = ['concat.txt', 'output.opus', 'silence.mp3'];

    // Add potential input files (scan reasonable range)
    for (let i = 0; i < 500; i++) {
      filesToDelete.push(`input_${i.toString().padStart(5, '0')}.mp3`);
    }

    for (const file of filesToDelete) {
      try {
        await this.ffmpeg.deleteFile(file);
      } catch {
        // Ignore errors, DO NOT break the loop
        // We want to try deleting everything
      }
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
    this.operationCount = 0;
  }
}

// Note: No longer exporting a singleton instance
// Use DI container to get the singleton: container.get(ServiceTypes.FFmpegService)
export default FFmpegService;
