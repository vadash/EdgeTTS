import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/config';

describe('defaultConfig.audio', () => {
  it('silenceThreshold should be -40', () => {
    expect(defaultConfig.audio.silenceThreshold).toBe(-40);
  });

  it('silenceStopDuration should be 0.3', () => {
    expect(defaultConfig.audio.silenceStopDuration).toBe(0.3);
  });

  it('normTruePeak should be -1.0', () => {
    expect(defaultConfig.audio.normTruePeak).toBe(-1.0);
  });
});
