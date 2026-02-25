// TypeScript interfaces for EdgeTTS application

// Audio Presets for Opus encoding
export enum AudioPreset {
  PC = 'pc',
  MOBILE = 'mobile',
  CUSTOM = 'custom'
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
    minBitrate: 32,
    maxBitrate: 64,
    compressionLevel: 10,
  },
  {
    name: AudioPreset.MOBILE,
    labelId: 'settings.preset.mobile',
    descriptionId: 'settings.preset.mobileDesc',
    minBitrate: 32,
    maxBitrate: 96,
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
  voice: string;
  narratorVoice: string;
  voicePoolLocale: string;
  enabledVoices: string[];
  rate: number;
  pitch: number;
  ttsThreads: number;
  llmThreads: number;
  lexxRegister: boolean;
  showDopSettings: boolean;
  isLiteMode: boolean;
  statusAreaWidth: number;
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
  stereoWidthEnabled: boolean;
  // Opus encoding settings
  opusPreset: AudioPreset;
  opusMinBitrate: number;
  opusMaxBitrate: number;
  opusCompressionLevel: number;
}

export interface ProcessedBook {
  fileNames: Array<[string, number]>;
  allSentences: string[];
  fullText: string;
}

export interface TTSWorker {
  id: number;
  filename: string;
  filenum: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  audioData: Uint8Array | null;
  mp3Saved: boolean;
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

export interface DictionaryRule {
  type: 'regex' | 'exact' | 'word';
  pattern: string;
  replacement: string;
}

export interface StatusUpdate {
  partIndex: number;
  message: string;
  isComplete: boolean;
}

// File System Access API types
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface ShowDirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

declare global {
  interface FileSystemDirectoryHandle {
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  interface Window {
    showDirectoryPicker?(options?: ShowDirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}

// Character Info (for non-LLM voice assignment - still used by VoiceAssigner)
export interface CharacterInfo {
  name: string;
  gender: 'male' | 'female' | 'unknown';
  occurrences: number;
  assignedVoice?: string;
}

export interface VoicePool {
  male: string[];
  female: string[];
}

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

export interface ExtractResponse {
  characters: LLMCharacter[];
}

export interface AssignResponse {
  sentences: Array<{ index: number; speaker: string }>;
}

export interface CharacterMergeEntry {
  keep: string;
  absorb: string[];
  variations: string[];
  gender: 'male' | 'female' | 'unknown';
}

export interface MergeResponse {
  merges: CharacterMergeEntry[];
  unchanged: string[];
}

export interface SpeakerAssignment {
  sentenceIndex: number;
  text: string;
  speaker: string;
  voiceId: string;
}

export interface LLMValidationResult {
  valid: boolean;
  errors: string[];
  repairedResponse?: string;
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

export interface VoiceAssignment {
  character: string;
  voice: string;
  shared: boolean;
}

// Voice Profile Constants
export const IMPORTANCE_THRESHOLD = 0.005; // 0.5%
export const MAX_NAME_EDITS = 2;
export const MIN_NAME_PAIRINGS = 2;
