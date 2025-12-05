// Application Configuration
// Centralized configuration extracted from magic numbers across services

export interface TTSConfig {
  /** Maximum concurrent WebSocket workers */
  maxWorkers: number;
  /** Initial retry delay in ms */
  initialRetryDelay: number;
  /** Second retry delay in ms */
  secondRetryDelay: number;
  /** Multiplier for exponential backoff after second retry */
  retryMultiplier: number;
  /** Maximum retry delay in ms */
  maxRetryDelay: number;
  /** Rate limit: workers per minute */
  workersPerMinute: number;
  /** Cooldown after error before spawning new workers (ms) */
  errorCooldown: number;
}

export interface AudioConfig {
  /** Target merge duration in minutes */
  targetDurationMinutes: number;
  /** Tolerance percent for merge duration */
  tolerancePercent: number;
  /** Edge TTS output: 96kbps = 12 bytes/ms */
  bytesPerMs: number;
  /** Opus encoding bitrate (kbps) */
  opusBitrate: number;
  /** Opus compression level (1-10) */
  opusCompression: number;
  /** Sample rate (Hz) */
  sampleRate: number;
  /** Normalization LUFS target */
  normLufs: number;
  /** Normalization LRA */
  normLra: number;
  /** Normalization true peak (dB) */
  normTruePeak: number;
  /** Silence removal threshold (dB) */
  silenceThreshold: number;
  /** Silence start periods */
  silenceStartPeriods: number;
  /** Silence start duration (seconds) */
  silenceStartDuration: number;
  /** Silence stop periods (-1 = no limit) */
  silenceStopPeriods: number;
  /** Silence stop duration (seconds) */
  silenceStopDuration: number;
}

export interface LLMConfig {
  /** Token limit for Pass 1 blocks */
  pass1BlockTokens: number;
  /** Token limit for Pass 2 blocks */
  pass2BlockTokens: number;
  /** Maximum concurrent API requests */
  maxConcurrentRequests: number;
  /** Retry delays in ms (array for sequential delays) */
  retryDelays: number[];
  /** Maximum tokens for API response */
  maxTokens: number;
}

export interface FFmpegCDNMirror {
  /** Base URL for FFmpeg files */
  baseUrl: string;
  /** Core JS filename */
  coreJs: string;
  /** WASM filename */
  wasmJs: string;
}

export interface FFmpegConfig {
  /** CDN mirrors for loading FFmpeg */
  cdnMirrors: FFmpegCDNMirror[];
}

export interface EdgeTTSApiConfig {
  /** WebSocket base URL */
  baseUrl: string;
  /** Trusted client token */
  trustedClientToken: string;
  /** Security version header */
  secMsGecVersion: string;
  /** Audio format */
  audioFormat: string;
}

export interface AppConfig {
  tts: TTSConfig;
  audio: AudioConfig;
  llm: LLMConfig;
  ffmpeg: FFmpegConfig;
  edgeTtsApi: EdgeTTSApiConfig;
}

/**
 * Default application configuration
 */
export const defaultConfig: AppConfig = {
  tts: {
    maxWorkers: 20,
    initialRetryDelay: 5000, // 5 seconds
    secondRetryDelay: 10000, // 10 seconds
    retryMultiplier: 3,
    maxRetryDelay: 600000, // 10 minutes
    workersPerMinute: 70,
    errorCooldown: 10000, // 10 seconds
  },

  audio: {
    targetDurationMinutes: 30,
    tolerancePercent: 10,
    bytesPerMs: 12, // 96kbps = 12 bytes/ms
    opusBitrate: 64,
    opusCompression: 10,
    sampleRate: 24000,
    normLufs: -18,
    normLra: 7,
    normTruePeak: -1.5,
    silenceThreshold: -40,
    silenceStartPeriods: 1,
    silenceStartDuration: 0.5,
    silenceStopPeriods: -1,
    silenceStopDuration: 0.25,
  },

  llm: {
    pass1BlockTokens: 16000,
    pass2BlockTokens: 8000,
    maxConcurrentRequests: 20,
    retryDelays: [5000, 10000, 20000, 60000, 180000, 600000, 1200000, 2400000, 4800000],
    maxTokens: 4000,
  },

  ffmpeg: {
    cdnMirrors: [
      {
        baseUrl: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
        coreJs: 'ffmpeg-core.js',
        wasmJs: 'ffmpeg-core.wasm',
      },
      {
        baseUrl: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd',
        coreJs: 'ffmpeg-core.js',
        wasmJs: 'ffmpeg-core.wasm',
      },
      {
        baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg/0.12.10/umd',
        coreJs: 'ffmpeg-core.min.js',
        wasmJs: 'ffmpeg-core.wasm',
      },
    ],
  },

  edgeTtsApi: {
    baseUrl: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
    trustedClientToken: '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
    secMsGecVersion: '1-130.0.2849.68',
    audioFormat: 'audio-24khz-96kbitrate-mono-mp3',
  },
};

/**
 * Load configuration with localStorage overrides (if needed in future)
 */
export function loadConfig(): AppConfig {
  // For now, return default config
  // In future, could merge with localStorage overrides
  return { ...defaultConfig };
}

/**
 * Get retry delay based on attempt number for TTS
 */
export function getTTSRetryDelay(retryCount: number, config: TTSConfig = defaultConfig.tts): number {
  if (retryCount === 0) return config.initialRetryDelay;
  if (retryCount === 1) return config.secondRetryDelay;
  // For retry 2+: secondDelay * multiplier^(retryCount-1), capped at maxDelay
  const delay = config.secondRetryDelay * Math.pow(config.retryMultiplier, retryCount - 1);
  return Math.min(delay, config.maxRetryDelay);
}

/**
 * Get start delay between worker spawns
 */
export function getWorkerStartDelay(config: TTSConfig = defaultConfig.tts): number {
  return 60000 / config.workersPerMinute;
}
