// Application Configuration
// Centralized configuration extracted from magic numbers across services

import type { AudioSettings } from '@/state/types';

export interface TTSConfig {
  /** Maximum concurrent WebSocket workers */
  maxWorkers: number;
  /** Cooldown after error before spawning new workers (ms) */
  errorCooldown: number;
}

/**
 * FFmpeg chain constants used as fallbacks by
 * buildFilterChain/AudioMerger/FFmpegService. Extends AudioSettings so the
 * config literal can carry the user-facing defaults via one spread.
 */
export interface AudioConfig extends AudioSettings {
  /** Target merge duration in minutes */
  targetDurationMinutes: number;
  /** Tolerance percent for merge duration */
  tolerancePercent: number;
  /** Edge TTS output: 96kbps = 12 bytes/ms */
  bytesPerMs: number;
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
  /** Replacement-temperature budget for failed merge votes (does not retry; the vote pool replaces a failed attempt with a fresh temperature). */
  maxMergeRetries: number;
  /** Number of merge votes for consensus */
  mergeVoteCount: number;
  /** Percentage of voice pool allocated to top speakers (0.2 = 20%) */
  topSpeakerPoolPercent: number;
}

export interface RetryConfig {
  /** Retry delays in ms - after exhausted, stays on last value forever */
  delays: number[];
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
  edgeTtsApi: EdgeTTSApiConfig;
}

/**
 * The one AudioSettings default value object — single source for the
 * SettingsStore; spread into defaultConfig.audio below.
 */
export const defaultAudioSettings: AudioSettings = {
  silenceRemoval: true,
  normalization: true,
  deEss: true,
  silenceGapMs: 100,
  eq: false,
  compressor: false,
  fadeIn: true,
  opusMinBitrate: 24,
  opusMaxBitrate: 48,
  opusCompressionLevel: 10,
  mergeConcurrency: 2,
};

/**
 * Default application configuration
 */
export const defaultConfig: AppConfig = {
  tts: {
    maxWorkers: 15,
    errorCooldown: 10000, // 10 seconds
  },

  audio: {
    ...defaultAudioSettings,

    // FFmpeg chain constants
    targetDurationMinutes: 15,
    tolerancePercent: 10,
    bytesPerMs: 12, // 96kbps = 12 bytes/ms
    sampleRate: 24000,
    normLufs: -20,
    normLra: 7,
    normTruePeak: -1.0,
    silenceThreshold: -40,
    silenceStartPeriods: 1,
    silenceStartDuration: 0.75,
    silenceStopPeriods: -1, // Must be -1 (remove all trailing silence). Positive values truncate after N silence periods!
    silenceStopDuration: 0.3,
  },

  llm: {
    extractBlockTokens: 8000, // Free models love to reason for same amount of tokens
    assignBlockTokens: 4000, // Assign is hard job so we send less
    maxConcurrentRequests: 2,
    maxTokens: 8000,
    maxAssignRetries: 3,
    maxMergeRetries: 5,
    mergeVoteCount: 5,
    /** Percentage of voice pool allocated to top speakers (0.2 = 20%) */
    topSpeakerPoolPercent: 0.2,
  },

  retry: {
    // Shared retry delays for TTS and LLM - stays on last value forever
    // Extended to 10 minutes max to handle rate limiting
    delays: [5000, 10000, 30000, 60000, 120000, 300000, 600000],
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
