// TypeScript interfaces for EdgeTTS application

import type { ConversionStatus } from '@/stores/ConversionStore';
import type { LLMProcessingStatus } from '@/stores/LLMStore';

// Audio Presets for Opus encoding
export enum AudioPreset {
  PC = 'pc',
  MOBILE = 'mobile',
  CUSTOM = 'custom',
}

export interface AudioPresetConfig {
  name: AudioPreset;
  labelId: string;
  descriptionId: string;
  minBitrate: number;
  maxBitrate: number;
  compressionLevel: number;
}

export const AUDIO_PRESETS: AudioPresetConfig[] = [
  {
    name: AudioPreset.PC,
    labelId: 'settings.preset.pc',
    descriptionId: 'settings.preset.pcDesc',
    minBitrate: 24,
    maxBitrate: 48,
    compressionLevel: 10,
  },
  {
    name: AudioPreset.MOBILE,
    labelId: 'settings.preset.mobile',
    descriptionId: 'settings.preset.mobileDesc',
    minBitrate: 24,
    maxBitrate: 48,
    compressionLevel: 3,
  },
];

export interface VoiceOption {
  locale: string;
  name: string;
  fullValue: string;
  gender: 'male' | 'female';
}

export interface AppSettings {
  narratorVoice: string;
  enabledVoices: string[];
  rate: number;
  pitch: number;
  ttsThreads: number;
  llmThreads: number;
  lexxRegister: boolean;
  // Audio processing settings
  outputFormat: 'opus';
  silenceRemovalEnabled: boolean;
  normalizationEnabled: boolean;
  deEssEnabled: boolean;
  silenceGapMs: number;
  // Broadcast voice audio enhancement
  eqEnabled: boolean;
  compressorEnabled: boolean;
  fadeInEnabled: boolean;
  // Opus encoding settings
  opusPreset: AudioPreset;
  opusMinBitrate: number;
  opusMaxBitrate: number;
  opusCompressionLevel: number;
  mergeConcurrency: number;
}

/**
 * Audio processing and encoding flags configured on the Audio tab, carried
 * as one object from Conversion input into the audio merge.
 */
export interface AudioSettings {
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  opusMinBitrate: number;
  opusMaxBitrate: number;
  opusCompressionLevel: number;
  mergeConcurrency: number;
}

export interface ProcessedBook {
  fileNames: Array<[string, number]>;
  allSentences: string[];
  fullText: string;
}

export interface TTSConfig {
  voice: string;
  pitch: string;
  rate: string;
  volume: string;
}

export interface ConvertedFile {
  filename: string;
  content: string;
}

export interface StatusUpdate {
  partIndex: number;
  message: string;
  isComplete: boolean;
}

// File System Access API — partial augmentation for missing DOM lib members
declare global {
  interface FileSystemHandle {
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?:
        | FileSystemHandle
        | 'desktop'
        | 'documents'
        | 'downloads'
        | 'music'
        | 'pictures'
        | 'videos';
    }): Promise<FileSystemDirectoryHandle>;
  }
}

export interface VoicePool {
  male: string[];
  female: string[];
}

// LLM Stage Configuration

export type ReasoningLevel = 'auto' | 'high' | 'medium' | 'low';

export interface StageConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming: boolean;
  reasoning: ReasoningLevel | null;
  temperature: number;
  topP: number;
  repeatPrompt: boolean;
  corsMiddleware: string;
  /** Retry attempts for this stage before giving up (backup model takes over) */
  maxRetries: number;
}

// Deliberate StageConfig subsets: exports never include apiKey (keys stay on
// the device); copying leaves streaming/reasoning/corsMiddleware tuned per stage.
export const STAGE_EXPORT_FIELDS = [
  'apiUrl',
  'model',
  'streaming',
  'reasoning',
  'temperature',
  'maxRetries',
  'topP',
] as const satisfies readonly (keyof StageConfig)[];

export const STAGE_COPY_FIELDS = [
  'apiKey',
  'apiUrl',
  'model',
  'temperature',
  'topP',
  'repeatPrompt',
  'maxRetries',
] as const satisfies readonly (keyof StageConfig)[];

// LLM Voice Assignment Types
export interface LLMCharacter {
  canonicalName: string;
  variations: string[];
  gender: 'male' | 'female' | 'unknown';
  voiceId?: string;
}

export interface TextBlock {
  blockIndex: number;
  sentences: string[];
  sentenceStartIndex: number;
}

export interface SpeakerAssignment {
  sentenceIndex: number;
  text: string;
  speaker: string;
  voiceId: string;
}

// Voice Profile Types (v2)
export interface VoiceProfileFile {
  version: 2;
  narrator: string;
  totalLines: number;
  characters: Record<string, CharacterEntry>;
}

export interface CharacterEntry {
  canonicalName: string;
  voice: string;
  gender: 'male' | 'female' | 'unknown';
  aliases: string[];
  lines: number;
  percentage: number;
  lastSeenIn: string;
  bookAppearances: number;
}

// Voice Profile Constants
export const IMPORTANCE_THRESHOLD = 0.005; // 0.5%
export const MAX_NAME_EDITS = 2;
export const MIN_NAME_PAIRINGS = 2;

// Pipeline stage identifiers and their conversion/LLM status projection.
// Both stores import this module for types only — no runtime cycle.
export type StageId =
  | 'character-extraction'
  | 'voice-assignment'
  | 'speaker-assignment'
  | 'text-sanitization'
  | 'dictionary-processing'
  | 'tts-conversion'
  | 'audio-merge';

export const STAGE_STATUS: Record<
  StageId,
  { conversion: ConversionStatus | null; llm: LLMProcessingStatus | null }
> = {
  'character-extraction': { conversion: 'llm-extract', llm: 'extracting' },
  'voice-assignment': { conversion: null, llm: null },
  'speaker-assignment': { conversion: 'llm-assign', llm: 'assigning' },
  'text-sanitization': { conversion: null, llm: null },
  'dictionary-processing': { conversion: null, llm: null },
  'tts-conversion': { conversion: 'converting', llm: 'idle' },
  'audio-merge': { conversion: 'merging', llm: null },
};
