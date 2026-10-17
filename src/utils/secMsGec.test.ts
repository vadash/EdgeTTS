import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateSecMsGecV2 } from './secMsGec';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

// Vectors generated with the upstream Python reference (edge_tts drm.py,
// generate_sec_ms_gec_v2). These lock the CS64 + modified-SHA-256 port.
const VECTORS: ReadonlyArray<readonly [unixTimestamp: number, token: string]> = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [1700000100, '0919602B5750900A-EC9DD394F23CB5635CF62A0E8E24136DCD32B26D10C543B10082E482D7516397'],
  [2000000000, '2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E'],
];

describe('generateSecMsGecV2', () => {
  it.each(
    VECTORS,
  )('matches the Python reference vector at unix time %i', (unixTimestamp, token) => {
    expect(generateSecMsGecV2(TRUSTED_CLIENT_TOKEN, unixTimestamp)).toBe(token);
  });

  it('produces the v2 shape "<16 hex>-<64 hex>" for the current time', () => {
    expect(generateSecMsGecV2(TRUSTED_CLIENT_TOKEN)).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });

  it('is deterministic within a 5-minute bucket and differs across buckets', () => {
    const base = 1792201800; // multiple of 300
    const inBucket = generateSecMsGecV2(TRUSTED_CLIENT_TOKEN, base + 299);
    expect(inBucket).toBe(generateSecMsGecV2(TRUSTED_CLIENT_TOKEN, base));
    expect(generateSecMsGecV2(TRUSTED_CLIENT_TOKEN, base + 300)).not.toBe(inBucket);
  });

  it('does not fall back to standard SHA-256 as the digest half', () => {
    // The v2 digest is a modified SHA-256; the server rejects the v1 token
    // built from standard SHA-256 with HTTP 403.
    const ticks = Math.floor((1700000100 + 11644473600) / 300) * 300 * 10_000_000;
    const v1 = createHash('sha256')
      .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
      .digest('hex')
      .toUpperCase();
    const token = generateSecMsGecV2(TRUSTED_CLIENT_TOKEN, 1700000100);
    expect(token.endsWith(v1)).toBe(false);
  });
});
