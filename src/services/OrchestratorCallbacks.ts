// Orchestrator Callbacks - Type definitions for orchestrator-to-UI communication

import type { LLMCharacter, SpeakerAssignment, VoiceProfileFile } from '@/state/types';
import type { ConversionStatus } from '@/stores/ConversionStore';
import type { ResumeInfo } from './ResumeCheck';

/**
 * Progress information from workflow stages
 */
export interface WorkflowProgress {
  /** Current stage name */
  stage: string;
  /** Current item being processed */
  current: number;
  /** Total items to process */
  total: number;
  /** Human-readable message */
  message: string;
}

/**
 * Per-stage LLM configuration
 */
export interface StageLLMConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
}

/**
 * Input configuration snapshot — read once at the start of run().
 * Replaces all signal .value reads.
 */
export interface OrchestratorInput {
  // LLM config
  isLLMConfigured: boolean;
  extractConfig: StageLLMConfig;
  mergeConfig: StageLLMConfig;
  assignConfig: StageLLMConfig;
  useVoting: boolean;

  // Settings
  narratorVoice: string;
  voice: string;
  pitch: number;
  rate: number;
  ttsThreads: number;
  llmThreads: number;
  enabledVoices: string[];
  lexxRegister: boolean;
  outputFormat: 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  opusMinBitrate: number;
  opusMaxBitrate: number;
  opusCompressionLevel: number;

  // Data
  directoryHandle: FileSystemDirectoryHandle | null;
  detectedLanguage: string;
  dictionaryRaw: string[];
  textContent: string;
}

/**
 * Callbacks for the orchestrator to communicate state changes to the UI layer.
 * Replaces direct store writes.
 */
export interface OrchestratorCallbacks {
  onConversionStart: () => void;
  onConversionComplete: () => void;
  onConversionCancel: () => void;
  onError: (message: string, code: string) => void;
  onProgress: (progress: WorkflowProgress) => void;
  onStatusChange: (status: ConversionStatus) => void;
  onConversionProgress: (current: number, total: number) => void;
  onLLMProcessingStatus: (status: string) => void;
  onLLMBlockProgress: (current: number, total: number) => void;

  // Resume flow
  awaitResumeConfirmation: (info: ResumeInfo) => Promise<boolean>;

  // Voice review pause
  onCharactersReady: (characters: LLMCharacter[]) => void;
  onVoiceMapReady: (voiceMap: Map<string, string>) => void;
  onAssignmentsReady: (assignments: SpeakerAssignment[]) => void;
  awaitVoiceReview: () => Promise<{ voiceMap: Map<string, string>; existingProfile: VoiceProfileFile | null }>;

  // Cleanup
  clearTextContent: () => void;
  clearBook: () => void;
  startTimer: () => void;
  resetLLMState: () => void;
  setLLMError: (message: string) => void;
}
