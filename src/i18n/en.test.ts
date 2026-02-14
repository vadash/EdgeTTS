import { describe, it, expect } from 'vitest';
import en from '@/i18n/en.json';

describe('English i18n - Opus settings', () => {
  it('should have opusEncoding key', () => {
    expect(en.settings.opusEncoding).toBeDefined();
  });

  it('should have all preset labels', () => {
    expect(en.settings['preset.maxQuality']).toBe('Max Quality');
    expect(en.settings['preset.balanced']).toBe('Balanced');
    expect(en.settings['preset.fast']).toBe('Fast');
    expect(en.settings['preset.mobile']).toBe('Mobile');
    expect(en.settings['preset.custom']).toBe('Custom');
  });

  it('should have bitrate labels', () => {
    expect(en.settings.minBitrate).toBeDefined();
    expect(en.settings.maxBitrate).toBeDefined();
    expect(en.settings.compressionLevel).toBeDefined();
    expect(en.settings.kbps).toBe('kbps');
  });
});
