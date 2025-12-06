// Service Layer Interfaces
// These interfaces enable dependency injection, mocking, and testing

import type {
  TTSConfig,
  StatusUpdate,
  TextBlock,
  LLMCharacter,
  SpeakerAssignment,
} from '@/state/types';

// Re-export types that interfaces depend on
export type { StatusUpdate, TextBlock, LLMCharacter, SpeakerAssignment };

// ============================================================================
// TTS Service Interfaces
// ============================================================================

/**
 * Options for creating a TTS worker
 */
export interface TTSWorkerOptions {
  indexPart: number;
  filename: string;
  filenum: string;
  config: TTSConfig;
  text: string;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onComplete?: (audioData: Uint8Array) => void;
  onError?: (error: Error) => void;
}

/**
 * Individual TTS service instance (one per conversion task)
 */
export interface ITTSService {
  /** Start the TTS conversion */
  start(): void;
  /** Clear internal state */
  clear(): void;
}

/**
 * Task definition for the worker pool
 */
export interface PoolTask {
  partIndex: number;
  text: string;
  filename: string;
  filenum: string;
  voice?: string; // Per-task voice override
}

/**
 * Options for configuring the worker pool
 */
export interface WorkerPoolOptions {
  maxWorkers: number;
  config: TTSConfig;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskComplete?: (partIndex: number, audioData: Uint8Array) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
}

/**
 * Progress information from the worker pool
 */
export interface WorkerPoolProgress {
  completed: number;
  total: number;
  failed: number;
}

/**
 * Worker pool for managing concurrent TTS tasks
 */
export interface IWorkerPool {
  /** Add a single task to the queue */
  addTask(task: PoolTask): void;
  /** Add multiple tasks to the queue */
  addTasks(tasks: PoolTask[]): void;
  /** Get all completed audio data */
  getCompletedAudio(): Map<number, Uint8Array>;
  /** Get set of failed task indices */
  getFailedTasks(): Set<number>;
  /** Get current progress */
  getProgress(): WorkerPoolProgress;
  /** Clear all state and stop processing */
  clear(): void;
}

// ============================================================================
// Audio Merger Interfaces
// ============================================================================

/**
 * Configuration for audio merging
 */
export interface MergerConfig {
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
}

/**
 * Result of a merge operation
 */
export interface MergedFile {
  filename: string;
  blob: Blob;
  fromIndex: number;
  toIndex: number;
}

/**
 * Group of audio chunks to be merged
 */
export interface MergeGroup {
  fromIndex: number;
  toIndex: number;
  filename: string;
  mergeNumber: number;
  durationMs: number;
}

/**
 * Progress callback for merge operations
 */
export type MergeProgressCallback = (current: number, total: number, message: string) => void;

/**
 * Audio merger service
 */
export interface IAudioMerger {
  /** Calculate how to group audio chunks for merging */
  calculateMergeGroups(
    audioMap: Map<number, Uint8Array>,
    totalSentences: number,
    fileNames: Array<[string, number]>
  ): MergeGroup[];

  /** Merge audio chunks according to groups */
  merge(
    audioMap: Map<number, Uint8Array>,
    totalSentences: number,
    fileNames: Array<[string, number]>,
    onProgress?: MergeProgressCallback
  ): Promise<MergedFile[]>;

  /** Save merged files to a directory */
  saveMergedFiles(
    files: MergedFile[],
    directoryHandle?: FileSystemDirectoryHandle | null
  ): Promise<void>;
}

// ============================================================================
// LLM Service Interfaces
// ============================================================================

/**
 * Options for configuring LLM service
 */
export interface LLMServiceOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  directoryHandle?: FileSystemDirectoryHandle | null;
}

/**
 * Progress callback for LLM operations
 * @param current - Current progress count
 * @param total - Total count
 * @param message - Optional status message (e.g., "Merging characters...")
 */
export type ProgressCallback = (current: number, total: number, message?: string) => void;

/**
 * LLM service for character extraction and speaker assignment
 */
export interface ILLMService {
  /** Extract: Extract characters from text blocks */
  extractCharacters(
    blocks: TextBlock[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]>;

  /** Assign: Assign speakers to sentences */
  assignSpeakers(
    blocks: TextBlock[],
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<SpeakerAssignment[]>;

  /** Cancel ongoing operations */
  cancel(): void;

  /** Test API connection */
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

// ============================================================================
// FFmpeg Service Interfaces
// ============================================================================

/**
 * Configuration for audio processing
 */
export interface AudioProcessingOptions {
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
}

/**
 * Progress callback for FFmpeg loading
 */
export type FFmpegProgressCallback = (message: string) => void;

/**
 * FFmpeg service for audio encoding and processing
 */
export interface IFFmpegService {
  /** Load FFmpeg WASM from CDN */
  load(onProgress?: FFmpegProgressCallback): Promise<boolean>;

  /** Check if FFmpeg is loaded and available */
  isAvailable(): boolean;

  /** Get load error if loading failed */
  getLoadError(): string | null;

  /** Process audio chunks (concatenate, filter, encode) */
  processAudio(
    chunks: Uint8Array[],
    config: AudioProcessingOptions,
    onProgress?: FFmpegProgressCallback
  ): Promise<Uint8Array>;

  /** Terminate FFmpeg and free memory */
  terminate(): void;
}

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  elapsed: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Logger service interface
 */
export interface ILogger {
  /** Log debug message (dev only) */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Log info message */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log warning message */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Log error message */
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
}

// ============================================================================
// Secure Storage Interface
// ============================================================================

/**
 * Secure storage for sensitive data (API keys)
 */
export interface ISecureStorage {
  /** Encrypt and save API key */
  saveApiKey(key: string): Promise<void>;
  /** Load and decrypt API key */
  loadApiKey(): Promise<string>;
  /** Clear stored API key */
  clearApiKey(): Promise<void>;
}

// ============================================================================
// Voice Assignment Interfaces
// ============================================================================

/**
 * Voice pool organized by gender
 */
export interface VoicePool {
  male: string[];
  female: string[];
}

/**
 * Voice assigner for mapping characters to voices
 */
export interface IVoiceAssigner {
  /** Assign voices to detected characters from LLM extraction */
  assignVoicesFromLLMCharacters(characters: LLMCharacter[]): Map<string, string>;
  /** Get the narrator voice */
  getNarratorVoice(): string;
  /** Reset all assignments */
  reset(): void;
}

// ============================================================================
// File Converter Interface
// ============================================================================

/**
 * Converted file result
 */
export interface ConvertedFile {
  filename: string;
  content: string;
}

/**
 * File converter for different formats (TXT, FB2, EPUB, ZIP)
 */
export interface IFileConverter {
  /** Convert file to text */
  convert(file: File): Promise<ConvertedFile[]>;
  /** Check if file type is supported */
  isSupported(file: File): boolean;
}

// ============================================================================
// Text Block Splitter Interface
// ============================================================================

/**
 * Text block splitter for LLM processing
 * Splits text into blocks suitable for LLM token limits
 */
export interface ITextBlockSplitter {
  /** Create blocks for Extract (character extraction) */
  createExtractBlocks(text: string): TextBlock[];
  /** Create blocks for Assign (speaker assignment) */
  createAssignBlocks(text: string): TextBlock[];
}

// ============================================================================
// Voice Pool Builder Interface
// ============================================================================

/**
 * Voice pool builder for filtering voices by locale
 */
export interface IVoicePoolBuilder {
  /** Build voice pool filtered by locale and enabled voices */
  buildPool(locale: string, enabledVoices?: string[]): VoicePool;
}

// ============================================================================
// Pipeline Interfaces (re-exported from pipeline module)
// ============================================================================

// Note: Full pipeline types are in @/services/pipeline/types.ts
// These are simplified versions for DI registration

/**
 * LLM service factory options
 * Used to create LLM service instances with specific configuration
 */
export interface LLMServiceFactoryOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  narratorVoice: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  directoryHandle?: FileSystemDirectoryHandle | null;
}

/**
 * Factory for creating LLM service instances
 */
export interface ILLMServiceFactory {
  /** Create a new LLM service instance */
  create(options: LLMServiceFactoryOptions): ILLMService;
}

/**
 * Factory for creating worker pools
 */
export interface IWorkerPoolFactory {
  /** Create a new worker pool */
  create(options: WorkerPoolOptions): IWorkerPool;
}

/**
 * Factory for creating audio mergers
 */
export interface IAudioMergerFactory {
  /** Create a new audio merger */
  create(config: MergerConfig): IAudioMerger;
}

// ============================================================================
// EdgeTTS Service Interfaces
// ============================================================================

/**
 * Factory for creating EdgeTTS service instances
 * Used by TTSWorkerPool to create TTS workers
 */
export interface IEdgeTTSServiceFactory {
  /** Create a new EdgeTTS service instance */
  create(options: TTSWorkerOptions): ITTSService;
}

// ============================================================================
// VoiceAssigner Factory Interface
// ============================================================================

/**
 * Options for creating a VoiceAssigner
 */
export interface VoiceAssignerOptions {
  narratorVoice: string;
  locale?: string;
  voicePool?: VoicePool;
}

/**
 * Factory for creating VoiceAssigner instances
 */
export interface IVoiceAssignerFactory {
  /** Create a new VoiceAssigner instance */
  create(options: VoiceAssignerOptions): IVoiceAssigner;
  /** Create with filtered pool (detected language + multilingual, filtered by enabled voices) */
  createWithFilteredPool(narratorVoice: string, language: string, enabledVoices?: string[]): IVoiceAssigner;
}
