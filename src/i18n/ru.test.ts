import { describe, it, expect } from 'vitest';
import ru from '@/i18n/ru.json';

describe('Russian i18n - Opus settings', () => {
  it('should have opusEncoding key', () => {
    expect(ru.settings.opusEncoding).toBeDefined();
  });

  it('should have all preset labels', () => {
    expect(ru.settings['preset.pc']).toBeDefined();
    expect(ru.settings['preset.mobile']).toBeDefined();
  });

  it('should have bitrate labels', () => {
    expect(ru.settings.minBitrate).toBeDefined();
    expect(ru.settings.maxBitrate).toBeDefined();
    expect(ru.settings.compressionLevel).toBeDefined();
  });
});
