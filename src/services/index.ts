// Service Singletons and Factories
// ES modules handle singletons naturally, so no DI container is needed

import type { LoggerStore } from '@/services/Logger';
import type { MergerConfig } from './AudioMerger';
import { AudioMerger } from './AudioMerger';
import { ChunkStore } from './ChunkStore';
import { FFmpegService } from './FFmpegService';
import { createLogger, type Logger } from './Logger';
import { createLlmStages } from './llm/stages';
import { ReusableEdgeTTSService } from './ReusableEdgeTTSService';
import { TextBlockSplitter } from './TextBlockSplitter';
import type { WorkerPoolOptions } from './TTSWorkerPool';
import { TTSWorkerPool } from './TTSWorkerPool';
import { VoicePoolBuilder } from './VoicePoolBuilder';

// ============================================================================
// Core Singletons (initialized once)
// ============================================================================

let loggerInstance: Logger | null = null;
let ffmpegInstance: FFmpegService | null = null;
let textBlockSplitterInstance: TextBlockSplitter | null = null;
let voicePoolBuilderInstance: VoicePoolBuilder | null = null;
let ttsPreviewServiceInstance: ReusableEdgeTTSService | null = null;

export function getLogger(logStore?: LoggerStore): Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger(logStore);
  }
  return loggerInstance;
}

/** Test-only reset. */
export function resetLogger(): void {
  loggerInstance = null;
}

export function getFFmpeg(): FFmpegService {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpegService(getLogger());
  }
  return ffmpegInstance;
}

/** Test-only reset. */
export function resetFFmpeg(): void {
  ffmpegInstance = null;
}

export function getTextBlockSplitter(): TextBlockSplitter {
  if (!textBlockSplitterInstance) {
    textBlockSplitterInstance = new TextBlockSplitter();
  }
  return textBlockSplitterInstance;
}

export function getVoicePoolBuilder(): VoicePoolBuilder {
  if (!voicePoolBuilderInstance) {
    voicePoolBuilderInstance = new VoicePoolBuilder();
  }
  return voicePoolBuilderInstance;
}

/** Used by UI components for voice preview playback. */
export function getTTSPreviewService(): ReusableEdgeTTSService {
  if (!ttsPreviewServiceInstance) {
    ttsPreviewServiceInstance = new ReusableEdgeTTSService(getLogger());
  }
  return ttsPreviewServiceInstance;
}

// ============================================================================
// Factory Functions (create new instances each call)
// ============================================================================

export function createWorkerPool(options: WorkerPoolOptions): TTSWorkerPool {
  return TTSWorkerPool.create(options);
}

export function createAudioMerger(config: MergerConfig): AudioMerger {
  return new AudioMerger(getFFmpeg(), {
    ...config,
    ffmpegFactory: () => new FFmpegService(getLogger()),
  });
}

// ============================================================================
// Orchestrator Services Bundle
// ============================================================================

import type { ConversionOrchestratorServices } from './ConversionOrchestrator';

export function getOrchestratorServices(): ConversionOrchestratorServices {
  return {
    logger: getLogger(),
    textBlockSplitter: getTextBlockSplitter(),
    llmStagesFactory: { create: createLlmStages },
    workerPoolFactory: { create: createWorkerPool },
    audioMergerFactory: { create: createAudioMerger },
    voicePoolBuilder: getVoicePoolBuilder(),
    ffmpegService: getFFmpeg(),
    chunkStoreFactory: { create: () => new ChunkStore() },
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

// Export orchestrator types and function
export type {
  ConversionOrchestratorServices,
  OrchestratorInput,
  WorkflowProgress,
} from './ConversionOrchestrator';
export { runConversion } from './ConversionOrchestrator';
export { FFmpegService } from './FFmpegService';
export { createLogger, createLoggerStore, Logger } from './Logger';
export { ReusableEdgeTTSService } from './ReusableEdgeTTSService';
export { TextBlockSplitter } from './TextBlockSplitter';
export { VoicePoolBuilder } from './VoicePoolBuilder';
