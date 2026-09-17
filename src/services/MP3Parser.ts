// AudioMerger gets each Chunk's duration here to build merge groups.

const MPEG_VERSIONS = {
  0: 2.5, // MPEG Version 2.5
  1: null, // Reserved
  2: 2, // MPEG Version 2
  3: 1, // MPEG Version 1
} as const;

const LAYERS = {
  0: null, // Reserved
  1: 3, // Layer III
  2: 2, // Layer II
  3: 1, // Layer I
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

export function findSyncWord(buffer: Uint8Array, startOffset: number): number {
  for (let i = startOffset; i < buffer.length - 1; i++) {
    // Frame sync is 11 set bits (0xFF and first 3 bits of next byte)
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      return i;
    }
  }
  return -1;
}

function parseFrameHeader(buffer: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > buffer.length) {
    return null;
  }

  const byte1 = buffer[offset];
  const byte2 = buffer[offset + 1];
  const byte3 = buffer[offset + 2];
  const byte4 = buffer[offset + 3];

  if (byte1 !== 0xff || (byte2 & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (byte2 >> 3) & 0x03;
  const layerBits = (byte2 >> 1) & 0x03;
  const bitrateBits = (byte3 >> 4) & 0x0f;
  const sampleRateBits = (byte3 >> 2) & 0x03;
  const paddingBit = (byte3 >> 1) & 0x01;
  const channelModeBits = (byte4 >> 6) & 0x03;

  const mpegVersion = MPEG_VERSIONS[versionBits as keyof typeof MPEG_VERSIONS];
  const layer = LAYERS[layerBits as keyof typeof LAYERS];

  if (mpegVersion === null || layer === null) {
    return null;
  }

  // The MPEG 2 bitrate table also covers MPEG 2.5.
  const bitrateVersion = mpegVersion === 1 ? 1 : 2;
  const bitrateTable = BITRATE_TABLE[bitrateVersion]?.[layer];
  if (!bitrateTable) {
    return null;
  }
  const bitrate = bitrateTable[bitrateBits];
  if (bitrate === null || bitrate === undefined) {
    return null;
  }

  const sampleRateTable = SAMPLE_RATE_TABLE[mpegVersion];
  if (!sampleRateTable) {
    return null;
  }
  const sampleRate = sampleRateTable[sampleRateBits];
  if (sampleRate === null || sampleRate === undefined) {
    return null;
  }

  const samplesVersion = mpegVersion === 1 ? 1 : 2;
  const samplesPerFrame = SAMPLES_PER_FRAME[samplesVersion]?.[layer];
  if (!samplesPerFrame) {
    return null;
  }

  // Channel mode bits: 00 stereo, 01 joint stereo, 10 dual channel, 11 mono
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

  // Frame size formulas from the MPEG audio spec
  // Layer I: frame_size = (12 * bitrate / sample_rate + padding) * 4
  // Layer II/III stereo: frame_size = 144 * bitrate / sample_rate + padding
  // Layer II/III mono: frame_size = 72 * bitrate / sample_rate + padding
  let frameSize: number;
  if (layer === 1) {
    frameSize = Math.floor((12 * bitrate * 1000) / sampleRate + (paddingBit ? 1 : 0)) * 4;
  } else {
    const channelCoefficient = channelMode === 'mono' ? 72 : 144;
    frameSize =
      Math.floor((channelCoefficient * bitrate * 1000) / sampleRate) + (paddingBit ? 1 : 0);
  }

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

export function skipID3v2Tag(buffer: Uint8Array): number {
  if (buffer.length < 10) {
    return 0;
  }

  // ID3v2 tag starts with "ID3"
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
    return 0;
  }

  // The size is a syncsafe integer: 4 bytes, 7 bits per byte.
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);

  return 10 + size;
}

/**
 * Estimates duration by sampling frame headers instead of parsing every
 * frame. Fast, and accurate for the constant-bitrate output Edge TTS
 * produces.
 *
 * @param buffer MP3 data as Uint8Array
 * @param maxFramesToSample Maximum frames to analyze (default 100)
 * @returns Duration in milliseconds, or null if parsing fails
 */
export function parseMP3Duration(
  buffer: Uint8Array,
  maxFramesToSample: number = 100,
): number | null {
  if (buffer.length < 10) {
    return null;
  }

  let offset = skipID3v2Tag(buffer);

  offset = findSyncWord(buffer, offset);
  if (offset === -1) {
    return null;
  }

  let totalDurationMs = 0;
  let frameCount = 0;
  let totalBytesAnalyzed = 0;

  while (offset < buffer.length && frameCount < maxFramesToSample) {
    const header = parseFrameHeader(buffer, offset);

    if (header === null) {
      offset = findSyncWord(buffer, offset + 1);
      if (offset === -1) break;
      continue;
    }

    totalDurationMs += header.frameDurationMs;
    totalBytesAnalyzed += header.frameSize;
    frameCount++;
    offset += header.frameSize;
  }

  if (frameCount === 0 || totalBytesAnalyzed === 0) {
    return null;
  }

  // The file continues past the sampled frames, so extrapolate from the
  // sampled rate.
  if (offset < buffer.length && frameCount >= maxFramesToSample) {
    const msPerByte = totalDurationMs / totalBytesAnalyzed;

    const remainingBytes = buffer.length - offset;

    totalDurationMs += remainingBytes * msPerByte;
  }

  return Math.round(totalDurationMs);
}

/**
 * @param buffer MP3 data as Uint8Array
 * @returns Bitrate in kbps, or null if parsing fails
 */
export function getMP3Bitrate(buffer: Uint8Array): number | null {
  if (buffer.length < 10) {
    return null;
  }

  let offset = skipID3v2Tag(buffer);

  offset = findSyncWord(buffer, offset);
  if (offset === -1) {
    return null;
  }

  const header = parseFrameHeader(buffer, offset);
  return header?.bitrate ?? null;
}
