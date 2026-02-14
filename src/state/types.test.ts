import { describe, it, expect } from 'vitest';
import { AudioPreset, AUDIO_PRESETS } from '@/state/types';

describe('AudioPreset', () => {
  it('should have all preset values', () => {
    expect(AudioPreset.MAX_QUALITY).toBe('max_quality');
    expect(AudioPreset.BALANCED).toBe('balanced');
    expect(AudioPreset.FAST).toBe('fast');
    expect(AudioPreset.MOBILE).toBe('mobile');
    expect(AudioPreset.CUSTOM).toBe('custom');
  });

  it('AUDIO_PRESETS should have correct configuration', () => {
    const maxQuality = AUDIO_PRESETS.find(p => p.name === AudioPreset.MAX_QUALITY);
    expect(maxQuality?.minBitrate).toBe(128);
    expect(maxQuality?.maxBitrate).toBe(128);
    expect(maxQuality?.compressionLevel).toBe(10);

    const balanced = AUDIO_PRESETS.find(p => p.name === AudioPreset.BALANCED);
    expect(balanced?.minBitrate).toBe(64);
    expect(balanced?.maxBitrate).toBe(96);
    expect(balanced?.compressionLevel).toBe(10);

    const fast = AUDIO_PRESETS.find(p => p.name === AudioPreset.FAST);
    expect(fast?.minBitrate).toBe(48);
    expect(fast?.maxBitrate).toBe(64);
    expect(fast?.compressionLevel).toBe(5);

    const mobile = AUDIO_PRESETS.find(p => p.name === AudioPreset.MOBILE);
    expect(mobile?.minBitrate).toBe(32);
    expect(mobile?.maxBitrate).toBe(48);
    expect(mobile?.compressionLevel).toBe(3);
  });
});
