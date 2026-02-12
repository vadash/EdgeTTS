// Application Configuration
// Centralized configuration extracted from magic numbers across services

export interface TTSConfig {
  /** Maximum concurrent WebSocket workers */
  maxWorkers: number;
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
  /** Token limit for Extract blocks */
  extractBlockTokens: number;
  /** Token limit for Assign blocks */
  assignBlockTokens: number;
  /** Maximum concurrent API requests */
  maxConcurrentRequests: number;
  /** Maximum tokens for API response */
  maxTokens: number;
  /** Maximum retries for assign blocks before fallback to default voice */
  maxAssignRetries: number;
  /** Maximum retries for each merge vote before skipping */
  maxMergeRetries: number;
  /** Number of merge votes for consensus */
  mergeVoteCount: number;
}

export interface RetryConfig {
  /** Retry delays in ms - after exhausted, stays on last value forever */
  delays: number[];
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
  retry: RetryConfig;
  ffmpeg: FFmpegConfig;
  edgeTtsApi: EdgeTTSApiConfig;
}

/**
 * Default application configuration
 */
export const defaultConfig: AppConfig = {
  tts: {
    maxWorkers: 15,
    workersPerMinute: 50,
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
    normLra: 6,
    normTruePeak: -1.0,
    silenceThreshold: -55,
    silenceStartPeriods: 1,
    silenceStartDuration: 0.75,
    silenceStopPeriods: -1, // Must be -1 (remove all trailing silence). Positive values truncate after N silence periods!
    silenceStopDuration: 0.3,
  },

  llm: {
    extractBlockTokens: 16000,
    assignBlockTokens: 8000,
    maxConcurrentRequests: 2,
    maxTokens: 8000,
    maxAssignRetries: 3,
    maxMergeRetries: 5,
    mergeVoteCount: 5,
  },

  retry: {
    // Shared retry delays for TTS and LLM - stays on last value forever
    // Extended to 10 minutes max to handle rate limiting
    delays: [5000, 10000, 30000, 60000, 120000, 300000, 600000],
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
    secMsGecVersion: '1-143.0.3650.75',
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
 * Get retry delay based on attempt number (shared by TTS and LLM)
 * After exhausting the delays array, stays on the last value forever
 */
export function getRetryDelay(attempt: number, config: RetryConfig = defaultConfig.retry): number {
  const index = Math.min(attempt, config.delays.length - 1);
  return config.delays[index];
}

/**
 * Get start delay between worker spawns
 */
export function getWorkerStartDelay(config: TTSConfig = defaultConfig.tts): number {
  return 60000 / config.workersPerMinute;
}
