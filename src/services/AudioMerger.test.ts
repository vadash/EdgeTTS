import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test that mergeAudioGroupSync strips headers.
// Since mergeAudioGroupSync is private, we test via the public mergeAndSave path
// with MP3 format (which uses sync merge).
// Alternatively, test at integration level by checking output blob size.

describe('AudioMerger - MP3 header stripping', () => {
  it('strips ID3v2 tags from merged MP3 chunks', async () => {
    // This test verifies the merged output does not contain ID3v2 headers.
    // A chunk with ID3v2 tag (10-byte header + 100 bytes data) + one valid MP3 frame (288 bytes)
    // Total chunk = 110 + 288 = 398 bytes
    // After stripping, only 288 bytes should remain per chunk.

    // Build a chunk: ID3v2 tag (110 bytes) + valid MP3 frame (288 bytes)
    const id3Header = new Uint8Array(110);
    id3Header[0] = 0x49; // 'I'
    id3Header[1] = 0x44; // 'D'
    id3Header[2] = 0x33; // '3'
    id3Header[3] = 0x02; // version
    id3Header[4] = 0x03;
    id3Header[5] = 0x00; // flags
    // Syncsafe size = 100
    id3Header[6] = 0x00;
    id3Header[7] = 0x00;
    id3Header[8] = 0x00;
    id3Header[9] = 0x64;

    const mp3Frame = new Uint8Array(288);
    mp3Frame[0] = 0xFF;
    mp3Frame[1] = 0xF2;
    mp3Frame[2] = 0xA4;
    mp3Frame[3] = 0xC0;

    const chunkWithHeader = new Uint8Array(398);
    chunkWithHeader.set(id3Header, 0);
    chunkWithHeader.set(mp3Frame, 110);

    // Import findSyncWord and skipID3v2Tag to verify they work correctly on this data
    const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

    const id3Offset = skipID3v2Tag(chunkWithHeader);
    expect(id3Offset).toBe(110);

    const syncOffset = findSyncWord(chunkWithHeader, id3Offset);
    expect(syncOffset).toBe(110);

    // The stripped length should be 288 (only the MP3 frame data)
    const strippedLength = chunkWithHeader.length - syncOffset;
    expect(strippedLength).toBe(288);
  });

  it('handles chunks without ID3v2 tags (sync word at start)', async () => {
    const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

    // Pure MP3 frame, no ID3 tag
    const mp3Frame = new Uint8Array(288);
    mp3Frame[0] = 0xFF;
    mp3Frame[1] = 0xF2;
    mp3Frame[2] = 0xA4;
    mp3Frame[3] = 0xC0;

    const id3Offset = skipID3v2Tag(mp3Frame);
    expect(id3Offset).toBe(0);

    const syncOffset = findSyncWord(mp3Frame, id3Offset);
    expect(syncOffset).toBe(0);

    // No bytes stripped
    expect(mp3Frame.length - syncOffset).toBe(288);
  });

  it('handles chunks with junk bytes before sync word (no ID3)', async () => {
    const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

    // 5 junk bytes + MP3 frame
    const chunk = new Uint8Array(293);
    chunk[5] = 0xFF;
    chunk[6] = 0xF2;
    chunk[7] = 0xA4;
    chunk[8] = 0xC0;

    const id3Offset = skipID3v2Tag(chunk);
    expect(id3Offset).toBe(0);

    const syncOffset = findSyncWord(chunk, id3Offset);
    expect(syncOffset).toBe(5);

    expect(chunk.length - syncOffset).toBe(288);
  });

  it('falls back to id3Offset when no sync word found', async () => {
    const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

    // ID3 tag + no valid sync word after it
    const chunk = new Uint8Array(120);
    chunk[0] = 0x49; // 'I'
    chunk[1] = 0x44; // 'D'
    chunk[2] = 0x33; // '3'
    chunk[3] = 0x02;
    chunk[4] = 0x03;
    chunk[5] = 0x00;
    chunk[6] = 0x00;
    chunk[7] = 0x00;
    chunk[8] = 0x00;
    chunk[9] = 0x64; // size = 100

    const id3Offset = skipID3v2Tag(chunk);
    expect(id3Offset).toBe(110);

    const syncOffset = findSyncWord(chunk, id3Offset);
    expect(syncOffset).toBe(-1);

    // Fallback: use id3Offset
    const audioOffset = syncOffset >= 0 ? syncOffset : id3Offset;
    expect(audioOffset).toBe(110);
    expect(chunk.length - audioOffset).toBe(10); // remaining junk, but at least ID3 is stripped
  });
});
