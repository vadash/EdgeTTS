// Pipeline Builder
// Extracts pipeline construction logic from ConversionOrchestrator

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { IPipelineRunner } from './types';
import type { StepRegistry } from './StepRegistry';
import {
  pipelineConfig,
  buildPipelineFromConfig,
  StepNames,
} from './index';
import type {
  IFFmpegService,
  ITextBlockSplitter,
  ILLMServiceFactory,
  IWorkerPoolFactory,
  IAudioMergerFactory,
  IVoiceAssignerFactory,
  IVoicePoolBuilder,
  ILogger,
  LLMServiceFactoryOptions,
  WorkerPoolOptions,
  MergerConfig,
} from '@/services/interfaces';
import type { TTSConfig } from '@/state/types';

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
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;

  // Per-stage LLM settings
  extractConfig: StageLLMConfig;
  mergeConfig: StageLLMConfig;
  assignConfig: StageLLMConfig;
  useVoting?: boolean;

  // Data
  detectedLanguage: string;
  directoryHandle: FileSystemDirectoryHandle | null;
}

/**
 * Interface for PipelineBuilder
 */
export interface IPipelineBuilder {
  build(options: PipelineBuilderOptions): IPipelineRunner;
}

/**
 * Builds configured pipelines for TTS conversion
 * Extracts pipeline construction logic for better testability and separation of concerns
 */
export class PipelineBuilder implements IPipelineBuilder {
  private textBlockSplitter: ITextBlockSplitter;
  private llmServiceFactory: ILLMServiceFactory;
  private workerPoolFactory: IWorkerPoolFactory;
  private audioMergerFactory: IAudioMergerFactory;
  private voiceAssignerFactory: IVoiceAssignerFactory;
  private voicePoolBuilder: IVoicePoolBuilder;
  private ffmpegService: IFFmpegService;
  private logger: ILogger;

  constructor(
    private container: ServiceContainer,
    private stepRegistry: StepRegistry
  ) {
    this.textBlockSplitter = container.get<ITextBlockSplitter>(ServiceTypes.TextBlockSplitter);
    this.llmServiceFactory = container.get<ILLMServiceFactory>(ServiceTypes.LLMServiceFactory);
    this.workerPoolFactory = container.get<IWorkerPoolFactory>(ServiceTypes.WorkerPoolFactory);
    this.audioMergerFactory = container.get<IAudioMergerFactory>(ServiceTypes.AudioMergerFactory);
    this.voiceAssignerFactory = container.get<IVoiceAssignerFactory>(ServiceTypes.VoiceAssignerFactory);
    this.voicePoolBuilder = container.get<IVoicePoolBuilder>(ServiceTypes.VoicePoolBuilder);
    this.ffmpegService = container.get<IFFmpegService>(ServiceTypes.FFmpegService);
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
  }

  /**
   * Build a fully configured pipeline
   */
  build(options: PipelineBuilderOptions): IPipelineRunner {
    const pipeline = this.container.get<IPipelineRunner>(ServiceTypes.PipelineRunner);

    // Build LLM options for extract stage (includes merge config)
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
      // Pass merge config for the merge phase
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

    // Build pipeline configuration declaratively
    const config = pipelineConfig()
      .addStep(StepNames.CHARACTER_EXTRACTION, {
        llmOptions: extractLLMOptions,
        createLLMService: (opts: LLMServiceFactoryOptions) => this.llmServiceFactory.create(opts),
        textBlockSplitter: this.textBlockSplitter,
      })
      .addStep(StepNames.VOICE_ASSIGNMENT, {
        narratorVoice: options.narratorVoice,
        detectedLanguage: options.detectedLanguage,
        enabledVoices: options.enabledVoices,
        createVoiceAssigner: (narratorVoice: string, locale: string, enabledVoices?: string[]) =>
          this.voiceAssignerFactory.createWithFilteredPool(narratorVoice, locale, enabledVoices),
      })
      .addStep(StepNames.SPEAKER_ASSIGNMENT, {
        llmOptions: assignLLMOptions,
        createLLMService: (opts: LLMServiceFactoryOptions) => this.llmServiceFactory.create(opts),
        textBlockSplitter: this.textBlockSplitter,
      })
      .addStep(StepNames.VOICE_REMAPPING, {
        narratorVoice: options.narratorVoice,
        pool: this.voicePoolBuilder.buildPool(options.detectedLanguage, options.enabledVoices),
      })
      .addStep(StepNames.TEXT_SANITIZATION, {})
      .addStep(StepNames.DICTIONARY_PROCESSING, {
        caseSensitive: options.lexxRegister,
      })
      .addStep(StepNames.TTS_CONVERSION, {
        maxWorkers: options.ttsThreads,
        ttsConfig,
        createWorkerPool: (opts: WorkerPoolOptions) => this.workerPoolFactory.create(opts),
      })
      .addStep(StepNames.AUDIO_MERGE, {
        outputFormat: options.outputFormat,
        silenceRemoval: options.silenceRemoval,
        normalization: options.normalization,
        deEss: options.deEss,
        ffmpegService: this.ffmpegService,
        createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
      })
      .addStep(StepNames.SAVE, {
        createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
        narratorVoice: options.narratorVoice,
      })
      .addStep(StepNames.CLEANUP, {
        logger: this.logger,
      })
      .build();

    return buildPipelineFromConfig(config, this.stepRegistry, pipeline);
  }
}

/**
 * Create a PipelineBuilder
 */
export function createPipelineBuilder(
  container: ServiceContainer,
  stepRegistry: StepRegistry
): PipelineBuilder {
  return new PipelineBuilder(container, stepRegistry);
}
