// Pipeline Builder
// Constructs pipeline steps directly without registry abstraction

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { IPipelineRunner } from './types';
import type {
  IFFmpegService,
  ITextBlockSplitter,
  ILLMServiceFactory,
  IWorkerPoolFactory,
  IAudioMergerFactory,
  IVoicePoolBuilder,
  ILogger,
  LLMServiceFactoryOptions,
  WorkerPoolOptions,
  MergerConfig,
} from '@/services/interfaces';
import type { TTSConfig } from '@/state/types';
import { PipelineRunner } from './PipelineRunner';

// Import step classes directly
import {
  CharacterExtractionStep,
  VoiceAssignmentStep,
  SpeakerAssignmentStep,
  VoiceRemappingStep,
  TextSanitizationStep,
  DictionaryProcessingStep,
  TTSConversionStep,
  AudioMergeStep,
  SaveStep,
  CleanupStep,
} from './steps';
import type { IPipelineStep } from './types';

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
 * Options required for building a pipeline
 */
export interface PipelineBuilderOptions {
  // Voice settings
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
  // Opus encoding settings
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;

  // Per-stage LLM settings
  extractConfig: StageLLMConfig;
  mergeConfig: StageLLMConfig;
  assignConfig: StageLLMConfig;
  useVoting?: boolean;

  // Data
  detectedLanguage: string;
  directoryHandle: FileSystemDirectoryHandle | null;

  // Resume: skip LLM steps when resuming with cached state
  skipLLMSteps?: boolean;
}

/**
 * Step names constant for type-safety (same as before)
 */
export const StepNames = {
  CHARACTER_EXTRACTION: 'character-extraction',
  VOICE_ASSIGNMENT: 'voice-assignment',
  SPEAKER_ASSIGNMENT: 'speaker-assignment',
  VOICE_REMAPPING: 'voice-remapping',
  TEXT_SANITIZATION: 'text-sanitization',
  DICTIONARY_PROCESSING: 'dictionary-processing',
  TTS_CONVERSION: 'tts-conversion',
  AUDIO_MERGE: 'audio-merge',
  SAVE: 'save',
  CLEANUP: 'cleanup',
} as const;

export type StepName = typeof StepNames[keyof typeof StepNames];

/**
 * Interface for PipelineBuilder
 */
export interface IPipelineBuilder {
  build(options: PipelineBuilderOptions): IPipelineRunner;
}

/**
 * Builds configured pipelines for TTS conversion
 * Simplified version - constructs steps directly without registry
 */
export class PipelineBuilder implements IPipelineBuilder {
  private textBlockSplitter: ITextBlockSplitter;
  private llmServiceFactory: ILLMServiceFactory;
  private workerPoolFactory: IWorkerPoolFactory;
  private audioMergerFactory: IAudioMergerFactory;
  private voicePoolBuilder: IVoicePoolBuilder;
  private ffmpegService: IFFmpegService;
  private logger: ILogger;

  constructor(private container: ServiceContainer) {
    this.textBlockSplitter = container.get<ITextBlockSplitter>(ServiceTypes.TextBlockSplitter);
    this.llmServiceFactory = container.get<ILLMServiceFactory>(ServiceTypes.LLMServiceFactory);
    this.workerPoolFactory = container.get<IWorkerPoolFactory>(ServiceTypes.WorkerPoolFactory);
    this.audioMergerFactory = container.get<IAudioMergerFactory>(ServiceTypes.AudioMergerFactory);
    this.voicePoolBuilder = container.get<IVoicePoolBuilder>(ServiceTypes.VoicePoolBuilder);
    this.ffmpegService = container.get<IFFmpegService>(ServiceTypes.FFmpegService);
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
  }

  /**
   * Build a fully configured pipeline runner with all steps
   */
  build(options: PipelineBuilderOptions): IPipelineRunner {
    const pipeline = new PipelineRunner(this.logger);

    // Build LLM options for extract stage
    const extractLLMOptions: LLMServiceFactoryOptions = {
      apiKey: options.extractConfig.apiKey,
      apiUrl: options.extractConfig.apiUrl,
      model: options.extractConfig.model,
      narratorVoice: options.narratorVoice,
      streaming: options.extractConfig.streaming,
      reasoning: options.extractConfig.reasoning,
      temperature: options.extractConfig.temperature,
      topP: options.extractConfig.topP,
      maxConcurrentRequests: options.llmThreads,
      directoryHandle: options.directoryHandle,
      logger: this.logger,
      mergeConfig: {
        apiKey: options.mergeConfig.apiKey,
        apiUrl: options.mergeConfig.apiUrl,
        model: options.mergeConfig.model,
        streaming: options.mergeConfig.streaming,
        reasoning: options.mergeConfig.reasoning,
        temperature: options.mergeConfig.temperature,
        topP: options.mergeConfig.topP,
      },
    };

    // Build LLM options for assign stage
    const assignLLMOptions: LLMServiceFactoryOptions = {
      apiKey: options.assignConfig.apiKey,
      apiUrl: options.assignConfig.apiUrl,
      model: options.assignConfig.model,
      narratorVoice: options.narratorVoice,
      streaming: options.assignConfig.streaming,
      reasoning: options.assignConfig.reasoning,
      temperature: options.assignConfig.temperature,
      topP: options.assignConfig.topP,
      useVoting: options.useVoting,
      maxConcurrentRequests: options.llmThreads,
      directoryHandle: options.directoryHandle,
      logger: this.logger,
    };

    // Build TTS config
    const ttsConfig: TTSConfig = {
      voice: `Microsoft Server Speech Text to Speech Voice (${options.voice})`,
      pitch: options.pitch >= 0 ? `+${options.pitch}Hz` : `${options.pitch}Hz`,
      rate: options.rate >= 0 ? `+${options.rate}%` : `${options.rate}%`,
      volume: '+0%',
    };

    // Build voice pool
    const voicePool = this.voicePoolBuilder.buildPool(options.detectedLanguage, options.enabledVoices);

    // Add LLM steps only if not resuming with cached state
    if (!options.skipLLMSteps) {
      pipeline.addStep(new CharacterExtractionStep({
        llmOptions: extractLLMOptions,
        createLLMService: (opts: LLMServiceFactoryOptions) => this.llmServiceFactory.create(opts),
        textBlockSplitter: this.textBlockSplitter,
      }));

      pipeline.addStep(new VoiceAssignmentStep({
        narratorVoice: options.narratorVoice,
        pool: voicePool,
      }));

      pipeline.addStep(new SpeakerAssignmentStep({
        llmOptions: assignLLMOptions,
        createLLMService: (opts: LLMServiceFactoryOptions) => this.llmServiceFactory.create(opts),
        textBlockSplitter: this.textBlockSplitter,
      }));

      pipeline.addStep(new VoiceRemappingStep({
        narratorVoice: options.narratorVoice,
        pool: voicePool,
      }));
    }

    // Always add these steps (non-LLM or required for resume)
    pipeline.addStep(new SaveStep({
      narratorVoice: options.narratorVoice,
    }));

    pipeline.addStep(new TextSanitizationStep());

    pipeline.addStep(new DictionaryProcessingStep({
      caseSensitive: options.lexxRegister,
    }));

    pipeline.addStep(new TTSConversionStep({
      maxWorkers: options.ttsThreads,
      ttsConfig,
      createWorkerPool: (opts: WorkerPoolOptions) => this.workerPoolFactory.create(opts),
    }));

    pipeline.addStep(new AudioMergeStep({
      outputFormat: options.outputFormat,
      silenceRemoval: options.silenceRemoval,
      normalization: options.normalization,
      deEss: options.deEss,
      silenceGapMs: options.silenceGapMs,
      eq: options.eq,
      compressor: options.compressor,
      fadeIn: options.fadeIn,
      stereoWidth: options.stereoWidth,
      opusMinBitrate: options.opusMinBitrate,
      opusMaxBitrate: options.opusMaxBitrate,
      opusCompressionLevel: options.opusCompressionLevel,
      ffmpegService: this.ffmpegService,
      createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
    }));

    pipeline.addStep(new CleanupStep({
      logger: this.logger,
    }));

    return pipeline;
  }
}

/**
 * Create a PipelineBuilder
 */
export function createPipelineBuilder(
  container: ServiceContainer
): PipelineBuilder {
  return new PipelineBuilder(container);
}
