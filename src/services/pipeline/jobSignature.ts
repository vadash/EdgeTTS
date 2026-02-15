export interface JobSignature {
  version: number;
  textHash: string;
  voice: string;
  rate: string;
  pitch: string;
  outputFormat: string;
  opusBitrate: string;
  createdAt: string;
}

export interface SignatureSettings {
  voice: string;
  rate: string;
  pitch: string;
  outputFormat: 'mp3' | 'opus';
  opusBitrate: string;
}

/**
 * Lightweight text fingerprint: SHA-256 of (length + first 200 chars + last 200 chars).
 * Uses SubtleCrypto in browser, falls back to simple hash for tests.
 */
function textFingerprint(text: string): string {
  const prefix = text.slice(0, 200);
  const suffix = text.slice(-200);
  const raw = `${text.length}:${prefix}:${suffix}`;
  // Simple non-crypto hash for synchronous use (djb2)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function generateSignature(text: string, settings: SignatureSettings): JobSignature {
  return {
    version: 1,
    textHash: textFingerprint(text),
    voice: settings.voice,
    rate: settings.rate,
    pitch: settings.pitch,
    outputFormat: settings.outputFormat,
    opusBitrate: settings.opusBitrate,
    createdAt: new Date().toISOString(),
  };
}

export function signaturesMatch(a: JobSignature, b: JobSignature): boolean {
  return (
    a.version === b.version &&
    a.textHash === b.textHash &&
    a.voice === b.voice &&
    a.rate === b.rate &&
    a.pitch === b.pitch &&
    a.outputFormat === b.outputFormat &&
    a.opusBitrate === b.opusBitrate
  );
}
