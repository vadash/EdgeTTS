// Conversion Orchestrator
// Uses the pipeline architecture for cleaner, more testable code

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { Stores } from '@/stores';
import type {
  ILogger,
  IFFmpegService,
  ITextBlockSplitter,
  ILLMServiceFactory,
  IWorkerPoolFactory,
  IAudioMergerFactory,
  IVoiceAssignerFactory,
} from '@/services/interfaces';
import type { IPipelineRunner, PipelineContext, PipelineProgress } from '@/services/pipeline/types';
import type { ProcessedBook, TTSConfig as VoiceConfig } from '@/state/types';
import {
  pipelineConfig,
  buildPipelineFromConfig,
  createDefaultStepRegistry,
  StepNames,
  type StepRegistry,
} from './pipeline';
import { AppError, noContentError } from '@/errors';

/**
 * Orchestrates the full TTS conversion workflow using pipeline architecture
 */
export class ConversionOrchestrator {
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private ffmpegService: IFFmpegService;
  private textBlockSplitter: ITextBlockSplitter;
  private llmServiceFactory: ILLMServiceFactory;
  private workerPoolFactory: IWorkerPoolFactory;
  private audioMergerFactory: IAudioMergerFactory;
  private voiceAssignerFactory: IVoiceAssignerFactory;
  private stepRegistry: StepRegistry;

  constructor(
    private container: ServiceContainer,
    private stores: Stores
  ) {
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
    this.ffmpegService = container.get<IFFmpegService>(ServiceTypes.FFmpegService);
    this.textBlockSplitter = container.get<ITextBlockSplitter>(ServiceTypes.TextBlockSplitter);
    this.llmServiceFactory = container.get<ILLMServiceFactory>(ServiceTypes.LLMServiceFactory);
    this.workerPoolFactory = container.get<IWorkerPoolFactory>(ServiceTypes.WorkerPoolFactory);
    this.audioMergerFactory = container.get<IAudioMergerFactory>(ServiceTypes.AudioMergerFactory);
    this.voiceAssignerFactory = container.get<IVoiceAssignerFactory>(ServiceTypes.VoiceAssignerFactory);
    this.stepRegistry = createDefaultStepRegistry();
  }

  /**
   * Run the full conversion workflow
   */
  async run(text: string, existingBook?: ProcessedBook | null): Promise<void> {
    // Validate input
    if (!text.trim()) {
      throw noContentError();
    }

    // Check LLM configuration
    if (!this.stores.llm.isConfigured.value) {
      throw new AppError('LLM_NOT_CONFIGURED', 'LLM API key not configured');
    }

    // Initialize
    this.abortController = new AbortController();
    this.stores.conversion.startConversion();
    this.stores.logs.startTimer();
    this.stores.llm.resetProcessingState();

    // Detect and log language
    const detectedLang = this.stores.data.detectedLanguage.value;
    this.logger.info(`Detected language: ${detectedLang.toUpperCase()}`);

    const fileNames = existingBook?.fileNames ?? [[this.extractFilename(text), 0]] as Array<[string, number]>;

    try {
      // Build the pipeline
      const pipeline = this.buildPipeline();

      // Create initial context
      const context: PipelineContext = {
        text,
        fileNames,
        dictionaryRules: this.stores.data.dictionaryRaw.value,
        detectedLanguage: detectedLang,
        directoryHandle: this.stores.data.directoryHandle.value,
      };

      // Set up progress callback
      pipeline.setProgressCallback((progress: PipelineProgress) => {
        this.handleProgress(progress);
      });

      // Run the pipeline
      await pipeline.run(context, this.abortController.signal);

      // Complete
      this.stores.conversion.complete();
      this.logger.info('Conversion complete!');

    } catch (error) {
      if (error instanceof AppError && error.isCancellation()) {
        this.stores.conversion.cancel();
        this.logger.info('Conversion cancelled');
      } else if ((error as Error).message === 'Pipeline cancelled') {
        this.stores.conversion.cancel();
        this.logger.info('Conversion cancelled');
      } else {
        const appError = AppError.fromUnknown(error);
        this.stores.conversion.setError(appError.message, appError.code);
        this.stores.llm.setError(appError.message);
        this.logger.error('Conversion failed', appError);
        throw appError;
      }
    }
  }

  /**
   * Cancel the conversion
   */
  cancel(): void {
    this.abortController?.abort();
    this.stores.llm.resetProcessingState();
    this.stores.conversion.cancel();
    this.logger.info('Conversion cancelled by user');
  }

  /**
   * Build the conversion pipeline with all steps
   */
  private buildPipeline(): IPipelineRunner {
    const pipeline = this.container.get<IPipelineRunner>(ServiceTypes.PipelineRunner);
    const settings = this.stores.settings;
    const llmSettings = this.stores.llm;
    const detectedLang = this.stores.data.detectedLanguage.value;

    // Build step options
    const llmOptions = {
      apiKey: llmSettings.apiKey.value,
      apiUrl: llmSettings.apiUrl.value,
      model: llmSettings.model.value,
      narratorVoice: settings.narratorVoice.value,
      directoryHandle: this.stores.data.directoryHandle.value,
    };

    // Build pipeline configuration declaratively
    const config = pipelineConfig()
      .addStep(StepNames.CHARACTER_EXTRACTION, {
        llmOptions,
        createLLMService: (options: typeof llmOptions) => this.llmServiceFactory.create(options),
        textBlockSplitter: this.textBlockSplitter,
      })
      .addStep(StepNames.VOICE_ASSIGNMENT, {
        narratorVoice: settings.narratorVoice.value,
        detectedLanguage: detectedLang,
        enabledVoices: settings.enabledVoices.value,
        createVoiceAssigner: (narratorVoice: string, locale: string, enabledVoices?: string[]) =>
          this.voiceAssignerFactory.createWithFilteredPool(narratorVoice, locale, enabledVoices),
      })
      .addStep(StepNames.SPEAKER_ASSIGNMENT, {
        llmOptions,
        createLLMService: (options: typeof llmOptions) => this.llmServiceFactory.create(options),
        textBlockSplitter: this.textBlockSplitter,
      })
      .addStep(StepNames.TEXT_SANITIZATION, {})
      .addStep(StepNames.DICTIONARY_PROCESSING, {
        caseSensitive: settings.lexxRegister.value,
      })
      .addStep(StepNames.TTS_CONVERSION, {
        maxWorkers: settings.maxThreads.value,
        ttsConfig: this.buildTTSConfig(),
        createWorkerPool: (options: Parameters<typeof this.workerPoolFactory.create>[0]) =>
          this.workerPoolFactory.create(options),
      })
      .addStep(StepNames.AUDIO_MERGE, {
        outputFormat: settings.outputFormat.value,
        silenceRemoval: settings.silenceRemovalEnabled.value,
        normalization: settings.normalizationEnabled.value,
        ffmpegService: this.ffmpegService,
        createAudioMerger: (config: Parameters<typeof this.audioMergerFactory.create>[0]) =>
          this.audioMergerFactory.create(config),
      })
      .addStep(StepNames.SAVE, {
        createAudioMerger: (config: Parameters<typeof this.audioMergerFactory.create>[0]) =>
          this.audioMergerFactory.create(config),
      })
      .build();

    return buildPipelineFromConfig(config, this.stepRegistry, pipeline);
  }

  /**
   * Handle progress updates from pipeline steps
   */
  private handleProgress(progress: PipelineProgress): void {
    this.logger.info(progress.message);

    // Update store status based on step
    switch (progress.step) {
      case StepNames.CHARACTER_EXTRACTION:
        this.stores.conversion.setStatus('llm-pass1');
        this.stores.llm.setProcessingStatus('pass1');
        this.stores.llm.setBlockProgress(progress.current, progress.total);
        break;

      case StepNames.VOICE_ASSIGNMENT:
        // Short step, no special status
        break;

      case StepNames.SPEAKER_ASSIGNMENT:
        this.stores.conversion.setStatus('llm-pass2');
        this.stores.llm.setProcessingStatus('pass2');
        this.stores.llm.setBlockProgress(progress.current, progress.total);
        break;

      case StepNames.TEXT_SANITIZATION:
        // Short step, no special status
        break;

      case StepNames.DICTIONARY_PROCESSING:
        // Short step, no special status
        break;

      case StepNames.TTS_CONVERSION:
        this.stores.conversion.setStatus('converting');
        this.stores.llm.setProcessingStatus('idle');
        this.stores.conversion.updateProgress(progress.current, progress.total);
        break;

      case StepNames.AUDIO_MERGE:
        this.stores.conversion.setStatus('merging');
        break;

      case StepNames.SAVE:
        // Covered by merging status
        break;
    }
  }

  /**
   * Build TTS voice config from settings
   */
  private buildTTSConfig(): VoiceConfig {
    const settings = this.stores.settings;
    return {
      voice: `Microsoft Server Speech Text to Speech Voice (${settings.voice.value})`,
      pitch: settings.pitch.value >= 0 ? `+${settings.pitch.value}Hz` : `${settings.pitch.value}Hz`,
      rate: settings.rate.value >= 0 ? `+${settings.rate.value}%` : `${settings.rate.value}%`,
      volume: '+0%',
    };
  }

  /**
   * Extract filename from text
   */
  private extractFilename(text: string): string {
    const firstLine = text.split('\n').find(line => line.trim().length > 0);
    if (firstLine) {
      const cleaned = firstLine.trim().slice(0, 50).replace(/[<>:"/\\|?*]/g, '_');
      return cleaned || 'audio';
    }
    return 'audio';
  }
}

/**
 * Create a ConversionOrchestrator
 */
export function createConversionOrchestrator(
  container: ServiceContainer,
  stores: Stores
): ConversionOrchestrator {
  return new ConversionOrchestrator(container, stores);
}
