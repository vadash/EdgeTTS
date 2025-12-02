// TypeScript interfaces for EdgeTTS application

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
  rate: number;
  pitch: number;
  maxThreads: number;
  mergeFiles: number;
  pointsSelect: string;
  pointsType: 'V1' | 'V2' | 'V3';
  lexxRegister: boolean;
  showDopSettings: boolean;
  isLiteMode: boolean;
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

export interface ThreadsInfo {
  count: number;
  maxCount: number;
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
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

// Multi-voice types
export type SpeakerType = 'narrator' | 'character';

export interface DialogueSegment {
  text: string;
  speaker: string;           // 'narrator' or character name
  speakerType: SpeakerType;
  gender: 'male' | 'female' | 'unknown';
  originalIndex: number;
}

export interface CharacterInfo {
  name: string;
  gender: 'male' | 'female' | 'unknown';
  occurrences: number;
  assignedVoice?: string;
}

export interface ParsedDialogue {
  segments: DialogueSegment[];
  characters: Map<string, CharacterInfo>;
}

export interface VoiceAnnotatedChunk {
  text: string;
  voice: string;
  partIndex: number;
  speaker: string;
}

export interface VoicePool {
  male: string[];
  female: string[];
}
