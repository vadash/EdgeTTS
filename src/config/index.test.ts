import { describe, it, expect } from 'vitest';
import { defaultConfig } from '@/config';

describe('defaultConfig.audio', () => {
  it('silenceThreshold should be -55', () => {
    expect(defaultConfig.audio.silenceThreshold).toBe(-55);
  });

  it('silenceStopDuration should be 0.3', () => {
    expect(defaultConfig.audio.silenceStopDuration).toBe(0.3);
  });

  it('normTruePeak should be -1.0', () => {
    expect(defaultConfig.audio.normTruePeak).toBe(-1.0);
  });
});
