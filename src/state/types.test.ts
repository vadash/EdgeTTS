import { describe, expect, it } from 'vitest';
import { AUDIO_PRESETS, AudioPreset } from '@/state/types';
describe('AudioPreset', () => {
  it('should have all preset values', () => {
    expect(AudioPreset.PC).toBe('pc');
    expect(AudioPreset.MOBILE).toBe('mobile');
    expect(AudioPreset.CUSTOM).toBe('custom');
  });

  it('AUDIO_PRESETS should have correct configuration', () => {
    const pc = AUDIO_PRESETS.find((p) => p.name === AudioPreset.PC);
    expect(pc?.minBitrate).toBe(24);
    expect(pc?.maxBitrate).toBe(48);
    expect(pc?.compressionLevel).toBe(10);

    const mobile = AUDIO_PRESETS.find((p) => p.name === AudioPreset.MOBILE);
    expect(mobile?.minBitrate).toBe(24);
    expect(mobile?.maxBitrate).toBe(48);
    expect(mobile?.compressionLevel).toBe(3);
  });
});
