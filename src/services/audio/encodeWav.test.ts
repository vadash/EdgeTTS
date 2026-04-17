import { describe, it, expect } from 'vitest';
import { encodeWav } from './encodeWav';

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

function getView(buffer: ArrayBuffer) {
  return new DataView(buffer);
}

describe('encodeWav', () => {
  it('produces a valid WAV blob from silence (all zeros)', async () => {
    const pcm = new Float32Array(16000); // 1 second of silence at 16kHz
    const blob = encodeWav(pcm, 16000);

    expect(blob).toBeInstanceOf(Blob);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = getView(buffer);

    // RIFF header
    expect(
      String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
    ).toBe('RIFF');
    // WAVE format
    expect(
      String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)),
    ).toBe('WAVE');
    // fmt chunk
    expect(
      String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15),
      ),
    ).toBe('fmt ');
    // fmt chunk size = 16
    expect(view.getUint32(16, true)).toBe(16);
    // Audio format = 1 (PCM)
    expect(view.getUint16(20, true)).toBe(1);
    // Channels = 1 (mono)
    expect(view.getUint16(22, true)).toBe(1);
    // Sample rate
    expect(view.getUint32(24, true)).toBe(16000);
    // Bits per sample = 16
    expect(view.getUint16(34, true)).toBe(16);
    // data chunk
    expect(
      String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39),
      ),
    ).toBe('data');
    // data chunk size = numSamples * 2 (16-bit)
    expect(view.getUint32(40, true)).toBe(16000 * 2);
  });

  it('embeds the provided sample rate in the fmt chunk', async () => {
    const pcm = new Float32Array(48000);
    const blob = encodeWav(pcm, 48000);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = getView(buffer);

    expect(view.getUint32(24, true)).toBe(48000);
    // Byte rate = sampleRate * channels * bitsPerSample / 8 = 48000 * 1 * 2
    expect(view.getUint32(28, true)).toBe(48000 * 2);
    // Block align = channels * bitsPerSample / 8 = 2
    expect(view.getUint16(32, true)).toBe(2);
  });

  it('produces correct byte length for non-zero audio data', async () => {
    const pcm = new Float32Array([0.5, -0.5, 1.0, -1.0, 0.0]);
    const blob = encodeWav(pcm, 22050);
    const buffer = await readBlobAsArrayBuffer(blob);

    // 44 byte header + 5 samples * 2 bytes per sample = 54
    expect(buffer.byteLength).toBe(44 + pcm.length * 2);
  });

  it('produces a valid WAV from an empty Float32Array', async () => {
    const pcm = new Float32Array(0);
    const blob = encodeWav(pcm, 44100);
    const buffer = await readBlobAsArrayBuffer(blob);
    const view = getView(buffer);

    // RIFF header still present
    expect(
      String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
    ).toBe('RIFF');
    // data chunk size = 0
    expect(view.getUint32(40, true)).toBe(0);
    // Total size = 44 (just the header, no data)
    expect(buffer.byteLength).toBe(44);
  });
});
