import { describe, it, expect } from 'vitest';
import { parseMP3Duration, findSyncWord, skipID3v2Tag } from './MP3Parser';

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

describe('findSyncWord', () => {
  it('finds sync word at start of buffer', () => {
    const buffer = new Uint8Array([0xFF, 0xF2, 0xA4, 0xC0]);
    expect(findSyncWord(buffer, 0)).toBe(0);
  });

  it('finds sync word after junk bytes', () => {
    const buffer = new Uint8Array([0x00, 0x00, 0x00, 0xFF, 0xF2, 0xA4, 0xC0]);
    expect(findSyncWord(buffer, 0)).toBe(3);
  });

  it('returns -1 when no sync word found', () => {
    const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(findSyncWord(buffer, 0)).toBe(-1);
  });

  it('respects startOffset parameter', () => {
    // Two sync words: at 0 and at 4
    const buffer = new Uint8Array([0xFF, 0xF2, 0x00, 0x00, 0xFF, 0xE0, 0x00]);
    expect(findSyncWord(buffer, 1)).toBe(4);
  });
});

describe('skipID3v2Tag', () => {
  it('returns 0 when no ID3v2 tag present', () => {
    const buffer = new Uint8Array([0xFF, 0xF2, 0xA4, 0xC0, ...new Uint8Array(280)]);
    expect(skipID3v2Tag(buffer)).toBe(0);
  });

  it('returns 0 for buffer too small for ID3v2 header', () => {
    const buffer = new Uint8Array([0x49, 0x44, 0x33]);
    expect(skipID3v2Tag(buffer)).toBe(0);
  });

  it('skips ID3v2 tag and returns correct offset', () => {
    // "ID3" marker + version 2.3 + no flags + syncsafe size of 100
    const buffer = new Uint8Array(120);
    buffer[0] = 0x49; // 'I'
    buffer[1] = 0x44; // 'D'
    buffer[2] = 0x33; // '3'
    buffer[3] = 0x02; // version major
    buffer[4] = 0x03; // version minor
    buffer[5] = 0x00; // flags
    // Syncsafe size = 100: (0 << 21) | (0 << 14) | (0 << 7) | 100
    buffer[6] = 0x00;
    buffer[7] = 0x00;
    buffer[8] = 0x00;
    buffer[9] = 0x64; // 100
    expect(skipID3v2Tag(buffer)).toBe(110); // 10 header + 100 data
  });
});
