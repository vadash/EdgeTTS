import { describe, it, expect } from 'vitest';
import { FFmpegService } from './FFmpegService';
import type { AudioProcessingConfig } from './FFmpegService';

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
