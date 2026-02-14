import { describe, it, expect, vi } from 'vitest';
import { FFmpegService } from './FFmpegService';
import type { AudioProcessingConfig } from './FFmpegService';
import { LogStore } from '@/stores/LogStore';
import { AudioPreset } from '@/state/types';

// Access private method via prototype for testing filter chain logic
function buildFilterChain(config: any): string {
  const service = new FFmpegService();
  return (service as any).buildFilterChain(config);
}

describe('FFmpegService.buildFilterChain', () => {
  const allOff = {
    silenceRemoval: false,
    normalization: false,
    deEss: false,
    silenceGapMs: 0,
    eq: false,
    compressor: false,
    fadeIn: false,
    stereoWidth: false,
  };

  it('returns empty string when all filters disabled', () => {
    expect(buildFilterChain(allOff)).toBe('');
  });

  it('includes EQ filters when eq enabled', () => {
    const chain = buildFilterChain({ ...allOff, eq: true });
    expect(chain).toContain('highpass=f=60');
    expect(chain).toContain('lowshelf=f=120:g=2');
    expect(chain).toContain('equalizer=f=3000:t=q:w=1:g=-2');
  });

  it('includes deesser when deEss enabled', () => {
    const chain = buildFilterChain({ ...allOff, deEss: true });
    expect(chain).toContain('deesser=');
  });

  it('includes silenceremove when silenceRemoval enabled', () => {
    const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
    expect(chain).toContain('silenceremove=');
  });

  it('includes compand when compressor enabled', () => {
    const chain = buildFilterChain({ ...allOff, compressor: true });
    expect(chain).toContain('compand=');
  });

  it('includes loudnorm when normalization enabled', () => {
    const chain = buildFilterChain({ ...allOff, normalization: true });
    expect(chain).toContain('loudnorm=');
    expect(chain).toContain('dual_mono=true');
  });

  it('includes alimiter automatically when normalization enabled', () => {
    const chain = buildFilterChain({ ...allOff, normalization: true });
    expect(chain).toContain('alimiter=');
  });

  it('does NOT include alimiter when normalization disabled', () => {
    const chain = buildFilterChain({ ...allOff, compressor: true });
    expect(chain).not.toContain('alimiter=');
  });

  it('includes afade when fadeIn enabled', () => {
    const chain = buildFilterChain({ ...allOff, fadeIn: true });
    expect(chain).toContain('afade=t=in:ss=0:d=0.1');
  });

  it('includes aecho when stereoWidth enabled', () => {
    const chain = buildFilterChain({ ...allOff, stereoWidth: true });
    expect(chain).toContain('aecho=0.8:0.88:10:0.3');
  });

  it('maintains correct filter order: EQ before De-Ess before Silence before Compressor before Loudnorm before Limiter before FadeIn before Stereo', () => {
    const chain = buildFilterChain({
      silenceRemoval: true,
      normalization: true,
      deEss: true,
      silenceGapMs: 100,
      eq: true,
      compressor: true,
      fadeIn: true,
      stereoWidth: true,
    });
    const parts = chain.split(',');
    const eqIdx = parts.findIndex(p => p.includes('highpass'));
    const deEssIdx = parts.findIndex(p => p.includes('deesser'));
    const silenceIdx = parts.findIndex(p => p.includes('silenceremove'));
    const compIdx = parts.findIndex(p => p.includes('compand'));
    const normIdx = parts.findIndex(p => p.includes('loudnorm'));
    const limiterIdx = parts.findIndex(p => p.includes('alimiter'));
    const fadeIdx = parts.findIndex(p => p.includes('afade'));
    const stereoIdx = parts.findIndex(p => p.includes('aecho'));

    expect(eqIdx).toBeLessThan(deEssIdx);
    expect(deEssIdx).toBeLessThan(silenceIdx);
    expect(silenceIdx).toBeLessThan(compIdx);
    expect(compIdx).toBeLessThan(normIdx);
    expect(normIdx).toBeLessThan(limiterIdx);
    expect(limiterIdx).toBeLessThan(fadeIdx);
    expect(fadeIdx).toBeLessThan(stereoIdx);
  });
});

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
    const logStore = new LogStore();
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
    const logStore = new LogStore();
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
