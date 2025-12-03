// FFmpegService - Handles FFmpeg WASM loading and audio processing
// Provides Opus encoding, silence removal, and normalization

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { defaultConfig } from '@/config';

export interface AudioProcessingConfig {
  silenceRemoval: boolean;
  normalization: boolean;
}

interface CDNConfig {
  baseUrl: string;
  coreJs: string;
  wasmJs: string;
}

const CDN_MIRRORS: CDNConfig[] = defaultConfig.ffmpeg.cdnMirrors.map((url, index) => ({
  baseUrl: url,
  coreJs: index === 2 ? 'ffmpeg-core.min.js' : 'ffmpeg-core.js',
  wasmJs: 'ffmpeg-core.wasm',
}));

class FFmpegService {
  private static instance: FFmpegService | null = null;
  private ffmpeg: FFmpeg | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private loaded = false;
  private loadError: string | null = null;

  private constructor() {}

  static getInstance(): FFmpegService {
    if (!FFmpegService.instance) {
      FFmpegService.instance = new FFmpegService();
    }
    return FFmpegService.instance;
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
      console.log('[FFmpeg]', message);
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
        console.warn(`FFmpeg CDN ${cdn.baseUrl} failed:`, err);
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

      // Create concat file list
      const concatList = inputFiles.map(f => `file '${f}'`).join('\n');
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
    } catch {
      // Ignore cleanup errors
    }
  }

  private async cleanupAll(): Promise<void> {
    if (!this.ffmpeg) return;

    try {
      // Try to clean common files
      const filesToDelete = ['concat.txt', 'output.opus'];
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

export const ffmpegService = FFmpegService.getInstance();
export default FFmpegService;
