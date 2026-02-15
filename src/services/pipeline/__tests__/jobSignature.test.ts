import { describe, it, expect } from 'vitest';
import { generateSignature, signaturesMatch } from '../jobSignature';

describe('jobSignature', () => {
  const baseSettings = {
    voice: 'en-US-AriaNeural',
    rate: '+0%',
    pitch: '+0Hz',
    outputFormat: 'opus' as const,
    opusBitrate: '32k',
  };

  describe('generateSignature', () => {
    it('generates a signature object with version and textHash', () => {
      const sig = generateSignature('Hello world', baseSettings);
      expect(sig.version).toBe(1);
      expect(sig.textHash).toBeTypeOf('string');
      expect(sig.textHash.length).toBeGreaterThan(0);
      expect(sig.voice).toBe('en-US-AriaNeural');
      expect(sig.rate).toBe('+0%');
      expect(sig.pitch).toBe('+0Hz');
      expect(sig.outputFormat).toBe('opus');
      expect(sig.opusBitrate).toBe('32k');
      expect(sig.createdAt).toBeTypeOf('string');
    });

    it('produces identical hashes for identical text', () => {
      const sig1 = generateSignature('Same text', baseSettings);
      const sig2 = generateSignature('Same text', baseSettings);
      expect(sig1.textHash).toBe(sig2.textHash);
    });

    it('produces different hashes for different text', () => {
      const sig1 = generateSignature('Text A', baseSettings);
      const sig2 = generateSignature('Text B', baseSettings);
      expect(sig1.textHash).not.toBe(sig2.textHash);
    });

    it('uses first/last 200 chars + length for hash (long text)', () => {
      const longText = 'A'.repeat(500) + 'B'.repeat(500);
      const sig1 = generateSignature(longText, baseSettings);
      // Same prefix/suffix/length = same hash
      const sig2 = generateSignature(longText, baseSettings);
      expect(sig1.textHash).toBe(sig2.textHash);

      // Different middle but same first/last 200 + same length
      const altText = 'A'.repeat(500) + 'C'.repeat(500);
      const sig3 = generateSignature(altText, baseSettings);
      // Last 200 chars differ (B vs C), so hash differs
      expect(sig1.textHash).not.toBe(sig3.textHash);
    });
  });

  describe('signaturesMatch', () => {
    it('returns true for matching signatures', () => {
      const sig1 = generateSignature('Hello', baseSettings);
      const sig2 = generateSignature('Hello', baseSettings);
      expect(signaturesMatch(sig1, sig2)).toBe(true);
    });

    it('returns false when voice differs', () => {
      const sig1 = generateSignature('Hello', baseSettings);
      const sig2 = generateSignature('Hello', { ...baseSettings, voice: 'en-US-GuyNeural' });
      expect(signaturesMatch(sig1, sig2)).toBe(false);
    });

    it('returns false when text differs', () => {
      const sig1 = generateSignature('Hello', baseSettings);
      const sig2 = generateSignature('World', baseSettings);
      expect(signaturesMatch(sig1, sig2)).toBe(false);
    });

    it('returns false when version differs', () => {
      const sig1 = generateSignature('Hello', baseSettings);
      const sig2 = { ...generateSignature('Hello', baseSettings), version: 99 };
      expect(signaturesMatch(sig1, sig2)).toBe(false);
    });
  });
});
