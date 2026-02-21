import { describe, it, expect, vi } from 'vitest';
import { FFmpegService } from './FFmpegService';
import type { AudioProcessingConfig } from './FFmpegService';
import { LoggerStore } from '@/services/Logger';
import { AudioPreset } from '@/state/types';

describe('AudioProcessingConfig', () => {
  it('should accept Opus encoding parameters', () => {
    const config: AudioProcessingConfig = {
      silenceRemoval: true,
      normalization: true,
      deEss: true,
      silenceGapMs: 100,
      eq: true,
      compressor: true,
      fadeIn: true,
      stereoWidth: false,
      opusMinBitrate: 48,
      opusMaxBitrate: 64,
      opusCompressionLevel: 5,
    };
    expect(config.opusMinBitrate).toBe(48);
    expect(config.opusMaxBitrate).toBe(64);
    expect(config.opusCompressionLevel).toBe(5);
  });

  it('should work without Opus parameters (backward compat)', () => {
    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };
    expect(config.opusMinBitrate).toBeUndefined();
  });

  it('should have optional Opus fields in interface', () => {
    // This test will cause a type error if the fields aren't defined
    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };
    // @ts-expect-error - opusMinBitrate should be optional but undefined
    const minBitrate = config.opusMinBitrate;
    expect(minBitrate).toBeUndefined();
  });
});

describe('FFmpegService Opus integration', () => {
  it('should use custom Opus settings when provided', async () => {
    const logStore = new LoggerStore();
    const service = new FFmpegService(logStore);

    // Mock FFmpeg for testing - collect all args into a flat array
    const allCalls: string[] = [];
    (service as any).ffmpeg = {
      exec: async (args: string[]) => {
        allCalls.push(...args);  // Spread the array of args
        return;
      },
      writeFile: () => {},
      readFile: () => new Uint8Array(),
      deleteFile: () => {},
    };
    (service as any).loaded = true;

    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      opusMinBitrate: 48,
      opusMaxBitrate: 64,
      opusCompressionLevel: 5,
    };

    await service.processAudio([new Uint8Array()], config);

    // The last exec call should be the main processing one
    // Find the index of '-c:a' followed by 'libopus' which starts the Opus encoding args
    const codecIdx = allCalls.indexOf('-c:a');
    expect(codecIdx).toBeGreaterThan(-1);
    expect(allCalls[codecIdx + 1]).toBe('libopus');

    // Check that custom bitrate args are present (after codec)
    const bitrateIdx = allCalls.indexOf('-b:a');
    expect(bitrateIdx).toBeGreaterThan(-1);
    expect(allCalls[bitrateIdx + 1]).toBe('48k');

    // Check that compression level is present
    const compressionIdx = allCalls.indexOf('-compression_level');
    expect(compressionIdx).toBeGreaterThan(-1);
    expect(allCalls[compressionIdx + 1]).toBe('5');

    // Check that VBR is on
    expect(allCalls).toContain('-vbr');
    expect(allCalls).toContain('on');

    // Check maxrate is present when max > min
    expect(allCalls).toContain('-maxrate');
    expect(allCalls[allCalls.indexOf('-maxrate') + 1]).toBe('64k');
  });

  it('should use default Opus settings when not provided', async () => {
    const logStore = new LoggerStore();
    const service = new FFmpegService(logStore);

    const allCalls: string[] = [];
    (service as any).ffmpeg = {
      exec: async (args: string[]) => {
        allCalls.push(...args);
        return;
      },
      writeFile: () => {},
      readFile: () => new Uint8Array(),
      deleteFile: () => {},
    };
    (service as any).loaded = true;

    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      // No Opus settings - should use defaults
    };

    await service.processAudio([new Uint8Array()], config);

    // Should still have bitrate args (from default config)
    const bitrateIdx = allCalls.indexOf('-b:a');
    expect(bitrateIdx).toBeGreaterThan(-1);
    expect(allCalls[bitrateIdx + 1]).toMatch(/\d+k/); // Should be something like '64k'

    // Should still have compression level (from default config)
    const compressionIdx = allCalls.indexOf('-compression_level');
    expect(compressionIdx).toBeGreaterThan(-1);
  });
});
