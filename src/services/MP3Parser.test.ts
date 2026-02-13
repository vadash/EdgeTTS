import { describe, it, expect } from 'vitest';
import { parseMP3Duration } from './MP3Parser';

describe('MP3Parser - Edge TTS format', () => {
  it('should correctly parse MPEG Version 2, Layer III, 24kHz, 96kbps MONO', () => {
    // Edge TTS format: audio-24khz-96kbitrate-mono-mp3
    // MPEG Version 2 (bits 10), Layer III (bits 01), 24kHz (index 1), 96kbps (index 10), MONO (11)
    // Byte1: 0xFF (sync high byte)
    // Byte2: 0xF2 = 11110010 (sync=111, ver=10=2, layer=01=III, no_crc=0)
    // Byte3: 0xA4 = 10100100 (bitrate=1010=96k for MPEG2 L3, sr_idx=01=24kHz, padding=0, private=0)
    // Byte4: 0xC0 = 11000000 (channel_mode=11=mono, mode_ext=00, copyright=0, original=0, emphasis=0)
    // Frame size for MPEG2 L3 MONO: (72 * bitrate * 1000) / sampleRate + padding
    //                         = (72 * 96 * 1000) / 24000 + 0 = 288 bytes
    // Samples per frame for MPEG2 L3: 576
    // Frame duration: (576 / 24000) * 1000 = 24ms

    const frameData = new Uint8Array([
      0xFF, 0xF2, 0xA4, 0xC0,  // Frame header (4 bytes)
      ...new Uint8Array(284),     // Rest of frame data (288 - 4 = 284)
    ]);

    const duration = parseMP3Duration(frameData);
    expect(duration).not.toBeNull();

    // One frame at 24kHz MPEG2 L3 mono = 24ms
    expect(duration).toBe(24);
  });

  it('should correctly parse 100 frames of Edge TTS format', () => {
    const singleFrame = new Uint8Array([
      0xFF, 0xF2, 0xA4, 0xC0,  // Frame header (mono)
      ...new Uint8Array(284),     // Frame data
    ]);

    // Create 100 frames
    const hundredFrames = new Uint8Array(100 * 288);
    for (let i = 0; i < 100; i++) {
      hundredFrames.set(singleFrame, i * 288);
    }

    const duration = parseMP3Duration(hundredFrames, 100);
    expect(duration).toBe(2400); // 100 frames * 24ms = 2400ms
  });

  it('should correctly extrapolate for larger files', () => {
    const singleFrame = new Uint8Array([
      0xFF, 0xF2, 0xA4, 0xC0,
      ...new Uint8Array(284),
    ]);

    // Create 100 frames + 50 more frames (total 150)
    const data = new Uint8Array(150 * 288);
    for (let i = 0; i < 150; i++) {
      data.set(singleFrame, i * 288);
    }

    // Should sample 100 frames (2400ms) then extrapolate remaining 50
    // msPerByte = 2400ms / (100 * 288 bytes) = 2400 / 28800 = 0.0833 ms/byte
    // remaining = 50 * 288 = 14400 bytes
    // extrapolated = 14400 * 0.0833 = 1200ms
    // total = 2400 + 1200 = 3600ms
    const duration = parseMP3Duration(data, 100);
    expect(duration).toBe(3600);
  });
});
