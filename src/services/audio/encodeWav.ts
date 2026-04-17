/**
 * Encode raw PCM Float32 data into a WAV Blob (mono, 16-bit PCM, 44-byte header).
 * All multi-byte values are written little-endian per WAV spec.
 */
export function encodeWav(pcmData: Float32Array, sampleRate: number): Blob {
  const numSamples = pcmData.length;
  const dataBytes = numSamples * 2; // 16-bit = 2 bytes per sample
  const headerBytes = 44;
  const totalBytes = headerBytes + dataBytes;

  const header = new ArrayBuffer(headerBytes);
  const view = new DataView(header);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalBytes - 8, true); // file size - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, 1, true); // channels (1 = mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * channels * bitsPerSample/8)
  view.setUint16(32, 2, true); // block align (channels * bitsPerSample/8)
  view.setUint16(34, 16, true); // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Convert Float32 samples to Int16
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, pcmData[i]));
    samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return new Blob([header, samples.buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
