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
  LLMServiceFactoryOptions,
  WorkerPoolOptions,
  MergerConfig,
} from '@/services/interfaces';
import type { TTSConfig } from '@/state/types';

/**
 * Options required for building a pipeline
 */
export interface PipelineBuilderOptions {
  // Voice settings
  narratorVoice: string;
  voice: string;
  pitch: number;
  rate: number;
  maxThreads: number;
  enabledVoices: string[];
  lexxRegister: boolean;
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;

  // LLM settings
  apiKey: string;
  apiUrl: string;
  model: string;

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
  private ffmpegService: IFFmpegService;

  constructor(
    private container: ServiceContainer,
    private stepRegistry: StepRegistry
  ) {
    this.textBlockSplitter = container.get<ITextBlockSplitter>(ServiceTypes.TextBlockSplitter);
    this.llmServiceFactory = container.get<ILLMServiceFactory>(ServiceTypes.LLMServiceFactory);
    this.workerPoolFactory = container.get<IWorkerPoolFactory>(ServiceTypes.WorkerPoolFactory);
    this.audioMergerFactory = container.get<IAudioMergerFactory>(ServiceTypes.AudioMergerFactory);
    this.voiceAssignerFactory = container.get<IVoiceAssignerFactory>(ServiceTypes.VoiceAssignerFactory);
    this.ffmpegService = container.get<IFFmpegService>(ServiceTypes.FFmpegService);
  }

  /**
   * Build a fully configured pipeline
   */
  build(options: PipelineBuilderOptions): IPipelineRunner {
    const pipeline = this.container.get<IPipelineRunner>(ServiceTypes.PipelineRunner);

    // Build LLM options
    const llmOptions: LLMServiceFactoryOptions = {
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      model: options.model,
      narratorVoice: options.narratorVoice,
      directoryHandle: options.directoryHandle,
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
        llmOptions,
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
        llmOptions,
        createLLMService: (opts: LLMServiceFactoryOptions) => this.llmServiceFactory.create(opts),
        textBlockSplitter: this.textBlockSplitter,
      })
      .addStep(StepNames.TEXT_SANITIZATION, {})
      .addStep(StepNames.DICTIONARY_PROCESSING, {
        caseSensitive: options.lexxRegister,
      })
      .addStep(StepNames.TTS_CONVERSION, {
        maxWorkers: options.maxThreads,
        ttsConfig,
        createWorkerPool: (opts: WorkerPoolOptions) => this.workerPoolFactory.create(opts),
      })
      .addStep(StepNames.AUDIO_MERGE, {
        outputFormat: options.outputFormat,
        silenceRemoval: options.silenceRemoval,
        normalization: options.normalization,
        ffmpegService: this.ffmpegService,
        createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
      })
      .addStep(StepNames.SAVE, {
        createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
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
