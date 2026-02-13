// MP3 Parser - Parses MP3 frame headers to calculate exact duration
// Used by AudioMerger to accurately group audio files by duration

/**
 * MPEG Audio Version lookup table
 */
const MPEG_VERSIONS = {
  0b00: 2.5, // MPEG Version 2.5
  0b01: null, // Reserved
  0b10: 2, // MPEG Version 2
  0b11: 1, // MPEG Version 1
} as const;

/**
 * Layer description lookup table
 */
const LAYERS = {
  0b00: null, // Reserved
  0b01: 3, // Layer III
  0b10: 2, // Layer II
  0b11: 1, // Layer I
} as const;

/**
 * Bitrate lookup table (kbps)
 * Indexed by [MPEG version][Layer][bitrate index]
 */
const BITRATE_TABLE: Record<number, Record<number, (number | null)[]>> = {
  // MPEG Version 1
  1: {
    1: [null, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, null], // Layer I
    2: [null, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, null], // Layer II
    3: [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null], // Layer III
  },
  // MPEG Version 2 & 2.5
  2: {
    1: [null, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, null], // Layer I
    2: [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null], // Layer II
    3: [null, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, null], // Layer III
  },
};

/**
 * Sample rate lookup table (Hz)
 * Indexed by [MPEG version][sample rate index]
 */
const SAMPLE_RATE_TABLE: Record<number, (number | null)[]> = {
  1: [44100, 48000, 32000, null], // MPEG Version 1
  2: [22050, 24000, 16000, null], // MPEG Version 2
  2.5: [11025, 12000, 8000, null], // MPEG Version 2.5
};

/**
 * Samples per frame lookup table
 * Indexed by [MPEG version][Layer]
 */
const SAMPLES_PER_FRAME: Record<number, Record<number, number>> = {
  // MPEG Version 1
  1: {
    1: 384, // Layer I
    2: 1152, // Layer II
    3: 1152, // Layer III
  },
  // MPEG Version 2 & 2.5
  2: {
    1: 384, // Layer I
    2: 1152, // Layer II
    3: 576, // Layer III
  },
};

/**
 * Frame header information
 */
interface FrameHeader {
  mpegVersion: number;
  layer: number;
  bitrate: number;
  sampleRate: number;
  padding: boolean;
  channelMode: 'stereo' | 'joint-stereo' | 'dual-channel' | 'mono';
  frameSize: number;
  samplesPerFrame: number;
  frameDurationMs: number;
}

/**
 * Find the sync word (0xFFE0 to 0xFFFF with appropriate bits)
 * Returns the offset of the frame header start, or -1 if not found
 */
export function findSyncWord(buffer: Uint8Array, startOffset: number): number {
  for (let i = startOffset; i < buffer.length - 1; i++) {
    // Frame sync is 11 set bits (0xFF and first 3 bits of next byte)
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse a single MP3 frame header
 * Returns null if the header is invalid
 */
function parseFrameHeader(buffer: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > buffer.length) {
    return null;
  }

  const byte1 = buffer[offset];
  const byte2 = buffer[offset + 1];
  const byte3 = buffer[offset + 2];
  const byte4 = buffer[offset + 3];

  // Validate sync word
  if (byte1 !== 0xff || (byte2 & 0xe0) !== 0xe0) {
    return null;
  }

  // Extract header fields
  const versionBits = (byte2 >> 3) & 0x03;
  const layerBits = (byte2 >> 1) & 0x03;
  const bitrateBits = (byte3 >> 4) & 0x0f;
  const sampleRateBits = (byte3 >> 2) & 0x03;
  const paddingBit = (byte3 >> 1) & 0x01;
  const channelModeBits = (byte4 >> 6) & 0x03;

  // Look up values
  const mpegVersion = MPEG_VERSIONS[versionBits as keyof typeof MPEG_VERSIONS];
  const layer = LAYERS[layerBits as keyof typeof LAYERS];

  if (mpegVersion === null || layer === null) {
    return null;
  }

  // Get bitrate (using version 2 table for both v2 and v2.5)
  const bitrateVersion = mpegVersion === 1 ? 1 : 2;
  const bitrateTable = BITRATE_TABLE[bitrateVersion]?.[layer];
  if (!bitrateTable) {
    return null;
  }
  const bitrate = bitrateTable[bitrateBits];
  if (bitrate === null || bitrate === undefined) {
    return null;
  }

  // Get sample rate
  const sampleRateTable = SAMPLE_RATE_TABLE[mpegVersion];
  if (!sampleRateTable) {
    return null;
  }
  const sampleRate = sampleRateTable[sampleRateBits];
  if (sampleRate === null || sampleRate === undefined) {
    return null;
  }

  // Get samples per frame
  const samplesVersion = mpegVersion === 1 ? 1 : 2;
  const samplesPerFrame = SAMPLES_PER_FRAME[samplesVersion]?.[layer];
  if (!samplesPerFrame) {
    return null;
  }

  // Determine channel mode
  // 00: Stereo, 01: Joint Stereo, 10: Dual channel, 11: Mono
  let channelMode: 'stereo' | 'joint-stereo' | 'dual-channel' | 'mono';
  switch (channelModeBits) {
    case 0b00:
      channelMode = 'stereo';
      break;
    case 0b01:
      channelMode = 'joint-stereo';
      break;
    case 0b10:
      channelMode = 'dual-channel';
      break;
    case 0b11:
      channelMode = 'mono';
      break;
    default:
      return null;
  }

  // Calculate frame size
  // Layer I: frame_size = (12 * bitrate / sample_rate + padding) * 4
  // Layer II/III stereo: frame_size = 144 * bitrate / sample_rate + padding
  // Layer II/III mono: frame_size = 72 * bitrate / sample_rate + padding
  let frameSize: number;
  if (layer === 1) {
    frameSize = Math.floor((12 * bitrate * 1000) / sampleRate + (paddingBit ? 1 : 0)) * 4;
  } else {
    // For mono, use 72; for stereo/joint/dual, use 144
    const channelCoefficient = channelMode === 'mono' ? 72 : 144;
    frameSize = Math.floor((channelCoefficient * bitrate * 1000) / sampleRate) + (paddingBit ? 1 : 0);
  }

  // Calculate frame duration in milliseconds
  const frameDurationMs = (samplesPerFrame / sampleRate) * 1000;

  return {
    mpegVersion,
    layer,
    bitrate,
    sampleRate,
    padding: paddingBit === 1,
    channelMode,
    frameSize,
    samplesPerFrame,
    frameDurationMs,
  };
}

/**
 * Skip ID3v2 tag if present
 * Returns the offset after the ID3v2 tag, or 0 if no tag
 */
export function skipID3v2Tag(buffer: Uint8Array): number {
  // ID3v2 tag starts with "ID3"
  if (buffer.length < 10) {
    return 0;
  }

  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
    return 0; // No ID3v2 tag
  }

  // ID3v2 size is stored in 4 bytes (syncsafe integer)
  // Each byte only uses 7 bits
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);

  // Return offset after header (10 bytes) + tag size
  return 10 + size;
}

/**
 * Parse MP3 duration by analyzing frame headers
 *
 * Samples first N frames to estimate total duration.
 * This is faster than parsing every frame while still being accurate
 * for files with consistent bitrate (like Edge TTS output).
 *
 * @param buffer MP3 data as Uint8Array
 * @param maxFramesToSample Maximum frames to analyze (default 100)
 * @returns Duration in milliseconds, or null if parsing fails
 */
export function parseMP3Duration(
  buffer: Uint8Array,
  maxFramesToSample: number = 100
): number | null {
  if (buffer.length < 10) {
    return null;
  }

  // Skip ID3v2 tag if present
  let offset = skipID3v2Tag(buffer);

  // Find first frame
  offset = findSyncWord(buffer, offset);
  if (offset === -1) {
    return null;
  }

  // Parse frames to calculate duration
  let totalDurationMs = 0;
  let frameCount = 0;
  let totalBytesAnalyzed = 0;
  let lastValidFrameSize = 0;

  while (offset < buffer.length && frameCount < maxFramesToSample) {
    const header = parseFrameHeader(buffer, offset);

    if (header === null) {
      // Try to find next sync word
      offset = findSyncWord(buffer, offset + 1);
      if (offset === -1) break;
      continue;
    }

    totalDurationMs += header.frameDurationMs;
    totalBytesAnalyzed += header.frameSize;
    lastValidFrameSize = header.frameSize;
    frameCount++;
    offset += header.frameSize;
  }

  if (frameCount === 0 || totalBytesAnalyzed === 0) {
    return null;
  }

  // If we didn't parse the entire file, extrapolate
  if (offset < buffer.length && frameCount >= maxFramesToSample) {
    // Calculate average duration per byte
    const msPerByte = totalDurationMs / totalBytesAnalyzed;

    // Estimate remaining bytes (excluding any ID3v1 tag at end)
    const remainingBytes = buffer.length - offset;

    // Add estimated duration for remaining bytes
    totalDurationMs += remainingBytes * msPerByte;
  }

  return Math.round(totalDurationMs);
}

/**
 * Get bitrate from MP3 header
 * Useful for quick validation or fallback calculations
 *
 * @param buffer MP3 data as Uint8Array
 * @returns Bitrate in kbps, or null if parsing fails
 */
export function getMP3Bitrate(buffer: Uint8Array): number | null {
  if (buffer.length < 10) {
    return null;
  }

  // Skip ID3v2 tag if present
  let offset = skipID3v2Tag(buffer);

  // Find first frame
  offset = findSyncWord(buffer, offset);
  if (offset === -1) {
    return null;
  }

  const header = parseFrameHeader(buffer, offset);
  return header?.bitrate ?? null;
}
