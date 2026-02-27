// Mock FFmpeg Service
// Used for testing components that depend on FFmpeg functionality

import { vi } from 'vitest';
import type { AudioProcessingOptions, FFmpegProgressCallback } from '@/services/FFmpegService';

export class MockFFmpegService {
  private loaded = false;
  private shouldFail = false;
  private loadError: string | null = null;

  load = vi.fn(async (onProgress?: FFmpegProgressCallback): Promise<boolean> => {
    if (this.shouldFail) {
      this.loadError = 'FFmpeg load failed';
      throw new Error(this.loadError);
    }
    // Simulate loading progress
    if (onProgress) {
      onProgress('Loading FFmpeg core...');
      onProgress('Loading FFmpeg wasm...');
      onProgress('FFmpeg ready');
    }
    this.loaded = true;
    return true;
  });

  isAvailable = vi.fn(() => this.loaded);

  getLoadError = vi.fn(() => this.loadError);

  processAudio = vi.fn(
    async (
      chunks: Uint8Array[],
      _config: AudioProcessingOptions,
      onProgress?: FFmpegProgressCallback,
    ): Promise<Uint8Array> => {
      if (!this.loaded) {
        throw new Error('FFmpeg not loaded');
      }
      onProgress?.('Processing audio...');
      // Return concatenated chunks as mock processed audio
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      onProgress?.('Audio processing complete');
      return result;
    },
  );

  terminate = vi.fn(() => {
    this.loaded = false;
  });

  // Test helpers
  setLoaded(loaded: boolean): void {
    this.loaded = loaded;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  reset(): void {
    this.loaded = false;
    this.shouldFail = false;
    this.loadError = null;
  }
}

export function createMockFFmpegService(): MockFFmpegService {
  return new MockFFmpegService();
}
