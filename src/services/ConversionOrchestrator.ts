// Conversion Orchestrator
// Uses the pipeline architecture for cleaner, more testable code

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { Stores } from '@/stores';
import type { ILogger, IVoicePoolBuilder } from '@/services/interfaces';
import type { IPipelineBuilder } from '@/services/pipeline';
import type { PipelineContext, PipelineProgress } from '@/services/pipeline/types';
import type { ProcessedBook } from '@/state/types';
import { StepNames } from './pipeline';
import { AppError, noContentError, insufficientVoicesError } from '@/errors';

/**
 * Orchestrates the full TTS conversion workflow using pipeline architecture
 */
export class ConversionOrchestrator {
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private pipelineBuilder: IPipelineBuilder;
  private voicePoolBuilder: IVoicePoolBuilder;

  constructor(
    private container: ServiceContainer,
    private stores: Stores
  ) {
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
    this.pipelineBuilder = container.get<IPipelineBuilder>(ServiceTypes.PipelineBuilder);
    this.voicePoolBuilder = container.get<IVoicePoolBuilder>(ServiceTypes.VoicePoolBuilder);
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

    // Validate voice pool size (need 5+ total, 2+ male, 2+ female)
    const detectedLang = this.stores.data.detectedLanguage.value;
    const enabledVoices = this.stores.settings.enabledVoices.value;
    const pool = this.voicePoolBuilder.buildPool(detectedLang, enabledVoices);
    const totalVoices = pool.male.length + pool.female.length;
    if (totalVoices < 5 || pool.male.length < 2 || pool.female.length < 2) {
      throw insufficientVoicesError(pool.male.length, pool.female.length);
    }

    // Initialize
    this.abortController = new AbortController();
    this.stores.conversion.startConversion();
    this.stores.logs.startTimer();
    this.stores.llm.resetProcessingState();

    // Log language
    this.logger.info(`Detected language: ${detectedLang.toUpperCase()}`);

    const fileNames = existingBook?.fileNames ?? [[this.extractFilename(text), 0]] as Array<[string, number]>;

    try {
      // Build the pipeline using the builder
      const pipeline = this.pipelineBuilder.build({
        // Voice settings
        narratorVoice: this.stores.settings.narratorVoice.value,
        voice: this.stores.settings.voice.value,
        pitch: this.stores.settings.pitch.value,
        rate: this.stores.settings.rate.value,
        maxThreads: this.stores.settings.maxThreads.value,
        enabledVoices: this.stores.settings.enabledVoices.value,
        lexxRegister: this.stores.settings.lexxRegister.value,
        outputFormat: this.stores.settings.outputFormat.value,
        silenceRemoval: this.stores.settings.silenceRemovalEnabled.value,
        normalization: this.stores.settings.normalizationEnabled.value,
        deEss: this.stores.settings.deEssEnabled.value,

        // LLM settings
        apiKey: this.stores.llm.apiKey.value,
        apiUrl: this.stores.llm.apiUrl.value,
        model: this.stores.llm.model.value,

        // Data
        detectedLanguage: detectedLang,
        directoryHandle: this.stores.data.directoryHandle.value,
      });

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
   * Handle progress updates from pipeline steps
   */
  private handleProgress(progress: PipelineProgress): void {
    this.logger.info(progress.message);

    // Update store status based on step
    switch (progress.step) {
      case StepNames.CHARACTER_EXTRACTION:
        this.stores.conversion.setStatus('llm-extract');
        this.stores.llm.setProcessingStatus('extracting');
        this.stores.llm.setBlockProgress(progress.current, progress.total);
        break;

      case StepNames.VOICE_ASSIGNMENT:
        // Short step, no special status
        break;

      case StepNames.SPEAKER_ASSIGNMENT:
        this.stores.conversion.setStatus('llm-assign');
        this.stores.llm.setProcessingStatus('assigning');
        this.stores.llm.setBlockProgress(progress.current, progress.total);
        break;

      case StepNames.VOICE_REMAPPING:
        // Voice remapping logs its own table
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
