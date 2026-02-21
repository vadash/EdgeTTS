// Service Singletons and Factories
// ES Modules handle singletons naturally - no DI container needed

import type { LogStore } from '@/stores/LogStore';
import type { LLMServiceFactoryOptions } from './llm/LLMVoiceService';
import type { WorkerPoolOptions } from './TTSWorkerPool';
import type { MergerConfig } from './AudioMerger';
import { LoggerService } from './LoggerService';
import { FFmpegService } from './FFmpegService';
import { TextBlockSplitter } from './TextBlockSplitter';
import { VoicePoolBuilder } from './VoicePoolBuilder';
import { LLMVoiceService } from './llm/LLMVoiceService';
import { TTSWorkerPool } from './TTSWorkerPool';
import { AudioMerger } from './AudioMerger';
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';

// ============================================================================
// Core Singletons (initialized once)
// ============================================================================

let loggerInstance: LoggerService | null = null;
let ffmpegInstance: FFmpegService | null = null;
let textBlockSplitterInstance: TextBlockSplitter | null = null;
let voicePoolBuilderInstance: VoicePoolBuilder | null = null;
let ttsPreviewServiceInstance: ReusableEdgeTTSService | null = null;

/**
 * Get or create the logger singleton
 */
export function getLogger(logStore?: LogStore): LoggerService {
  if (!loggerInstance) {
    loggerInstance = logStore
      ? new LoggerService(logStore)
      : new LoggerService(undefined); // Uses console fallback
  }
  return loggerInstance;
}

/**
 * Reset the logger singleton (for testing)
 */
export function resetLogger(): void {
  loggerInstance = null;
}

/**
 * Get or create the FFmpeg service singleton
 */
export function getFFmpeg(): FFmpegService {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpegService(getLogger());
  }
  return ffmpegInstance;
}

/**
 * Reset the FFmpeg service singleton (for testing)
 */
export function resetFFmpeg(): void {
  ffmpegInstance = null;
}

/**
 * Get or create the text block splitter singleton
 */
export function getTextBlockSplitter(): TextBlockSplitter {
  if (!textBlockSplitterInstance) {
    textBlockSplitterInstance = new TextBlockSplitter();
  }
  return textBlockSplitterInstance;
}

/**
 * Get or create the voice pool builder singleton
 */
export function getVoicePoolBuilder(): VoicePoolBuilder {
  if (!voicePoolBuilderInstance) {
    voicePoolBuilderInstance = new VoicePoolBuilder();
  }
  return voicePoolBuilderInstance;
}

/**
 * Get or create the TTS preview service singleton
 * Used by UI components for voice preview playback
 */
export function getTTSPreviewService(): ReusableEdgeTTSService {
  if (!ttsPreviewServiceInstance) {
    ttsPreviewServiceInstance = new ReusableEdgeTTSService(getLogger());
  }
  return ttsPreviewServiceInstance;
}

// ============================================================================
// Factory Functions (create new instances each call)
// ============================================================================

/**
 * Create a new LLM service for a conversion
 */
export function createLLMService(options: LLMServiceFactoryOptions): LLMVoiceService {
  return new LLMVoiceService({ ...options, logger: getLogger() });
}

/**
 * Create a new TTS worker pool for a conversion
 */
export function createWorkerPool(options: WorkerPoolOptions): TTSWorkerPool {
  return new TTSWorkerPool(options);
}

/**
 * Create a new audio merger for a conversion
 */
export function createAudioMerger(config: MergerConfig): AudioMerger {
  return new AudioMerger(getFFmpeg(), config);
}

// ============================================================================
// Orchestrator Services Bundle
// ============================================================================

import type { ConversionOrchestratorServices } from './ConversionOrchestrator';

/**
 * Get the services bundle needed by ConversionOrchestrator
 */
export function getOrchestratorServices(): ConversionOrchestratorServices {
  return {
    logger: getLogger(),
    textBlockSplitter: getTextBlockSplitter(),
    llmServiceFactory: { create: createLLMService },
    workerPoolFactory: { create: createWorkerPool },
    audioMergerFactory: { create: createAudioMerger },
    voicePoolBuilder: getVoicePoolBuilder(),
    ffmpegService: getFFmpeg(),
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { LoggerService } from './LoggerService';
export { FFmpegService } from './FFmpegService';
export { TextBlockSplitter } from './TextBlockSplitter';
export { VoicePoolBuilder } from './VoicePoolBuilder';
export { ReusableEdgeTTSService } from './ReusableEdgeTTSService';

// Export orchestrator types and function
export type { OrchestratorInput, ConversionOrchestratorServices, WorkflowProgress, StageLLMConfig } from './ConversionOrchestrator';
export { runConversion } from './ConversionOrchestrator';
