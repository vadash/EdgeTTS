// Conversion Orchestrator
// Uses the pipeline architecture for cleaner, more testable code

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { ILogger, IVoicePoolBuilder } from '@/services/interfaces';
import type { IPipelineBuilder } from '@/services/pipeline';
import type { PipelineContext, PipelineProgress } from '@/services/pipeline/types';
import type { ProcessedBook, SpeakerAssignment, LLMCharacter } from '@/state/types';
import type { OrchestratorInput, OrchestratorCallbacks } from './OrchestratorCallbacks';
import { StepNames } from './pipeline';
import { AppError, noContentError, insufficientVoicesError } from '@/errors';
import { checkResumeState, loadPipelineState } from './pipeline/resumeCheck';

/**
 * Orchestrates the full TTS conversion workflow using pipeline architecture.
 * Decoupled from UI stores — communicates via OrchestratorCallbacks.
 */
export class ConversionOrchestrator {
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private pipelineBuilder: IPipelineBuilder;
  private voicePoolBuilder: IVoicePoolBuilder;

  constructor(
    private container: ServiceContainer,
    private callbacks: OrchestratorCallbacks
  ) {
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
    this.pipelineBuilder = container.get<IPipelineBuilder>(ServiceTypes.PipelineBuilder);
    this.voicePoolBuilder = container.get<IVoicePoolBuilder>(ServiceTypes.VoicePoolBuilder);
  }

  /**
   * Run the full conversion workflow
   */
  async run(input: OrchestratorInput, existingBook?: ProcessedBook | null): Promise<void> {
    const text = input.textContent;

    // Validate input
    if (!text.trim()) {
      throw noContentError();
    }

    // Check LLM configuration
    if (!input.isLLMConfigured) {
      throw new AppError('LLM_NOT_CONFIGURED', 'LLM API key not configured');
    }

    // Require directory handle - download mode is not supported
    const directoryHandle = input.directoryHandle;
    if (!directoryHandle) {
      throw new AppError('NO_DIRECTORY', 'Please select an output directory before converting');
    }

    // Check for resume state
    const resumeInfo = await checkResumeState(directoryHandle, (msg) => this.logger.info(msg));

    let skipLLMSteps = false;
    let resumedAssignments: SpeakerAssignment[] | undefined;
    let resumedVoiceMap: Map<string, string> | undefined;
    let resumedCharacters: LLMCharacter[] | undefined;

    if (resumeInfo) {
      // Resume detected - show modal and wait for user confirmation
      const confirmed = await this.callbacks.awaitResumeConfirmation(resumeInfo);
      if (!confirmed) {
        this.callbacks.onConversionCancel();
        this.logger.info('User cancelled resume, starting fresh');
        try {
          await directoryHandle.removeEntry('_temp_work', { recursive: true });
          this.logger.info('Cleaned up _temp_work directory');
        } catch {
          // Expected if no temp dir exists
        }
      } else {
        // User confirmed resume - load LLM state if available
        if (resumeInfo.hasLLMState) {
          const pipelineState = await loadPipelineState(directoryHandle);
          if (pipelineState) {
            skipLLMSteps = true;
            resumedAssignments = pipelineState.assignments;
            resumedVoiceMap = new Map(Object.entries(pipelineState.characterVoiceMap));
            resumedCharacters = pipelineState.characters;
            this.logger.info('Resuming with cached LLM state');
          }
        }
        if (resumeInfo.cachedChunks > 0) {
          this.logger.info(`Resuming with ${resumeInfo.cachedChunks} cached chunks`);
        }
      }
    } else {
      // Fresh start - clean any leftover _temp_work
      try {
        await directoryHandle.removeEntry('_temp_work', { recursive: true });
        this.logger.info('Cleaned up _temp_work directory');
      } catch {
        // Expected if no temp dir exists
      }
    }

    // Validate voice pool size (need 5+ total, 2+ male, 2+ female)
    const detectedLang = input.detectedLanguage;
    const pool = this.voicePoolBuilder.buildPool(detectedLang, input.enabledVoices);
    const totalVoices = pool.male.length + pool.female.length;
    if (totalVoices < 5 || pool.male.length < 2 || pool.female.length < 2) {
      throw insufficientVoicesError(pool.male.length, pool.female.length);
    }

    // Initialize
    this.abortController = new AbortController();
    this.callbacks.onConversionStart();
    this.callbacks.startTimer();
    this.callbacks.resetLLMState();

    // Clear text content immediately after conversion starts
    this.callbacks.clearTextContent();
    this.callbacks.clearBook();

    // Log language
    this.logger.info(`Detected language: ${detectedLang.toUpperCase()}`);

    const fileNames = existingBook?.fileNames ?? [[this.extractFilename(text), 0]] as Array<[string, number]>;

    try {
      // Build the pipeline using the builder
      const pipeline = this.pipelineBuilder.build({
        // Voice settings
        narratorVoice: input.narratorVoice,
        voice: input.voice,
        pitch: input.pitch,
        rate: input.rate,
        ttsThreads: input.ttsThreads,
        llmThreads: input.llmThreads,
        enabledVoices: input.enabledVoices,
        lexxRegister: input.lexxRegister,
        outputFormat: input.outputFormat,
        silenceRemoval: input.silenceRemoval,
        normalization: input.normalization,
        deEss: input.deEss,
        silenceGapMs: input.silenceGapMs,
        eq: input.eq,
        compressor: input.compressor,
        fadeIn: input.fadeIn,
        stereoWidth: input.stereoWidth,
        opusMinBitrate: input.opusMinBitrate,
        opusMaxBitrate: input.opusMaxBitrate,
        opusCompressionLevel: input.opusCompressionLevel,

        // Per-stage LLM settings
        extractConfig: input.extractConfig,
        mergeConfig: input.mergeConfig,
        assignConfig: input.assignConfig,
        useVoting: input.useVoting,

        // Data
        detectedLanguage: detectedLang,
        directoryHandle: input.directoryHandle,

        // Resume: skip LLM steps when resuming with cached state
        skipLLMSteps,
      });

      // Create initial context
      const context: PipelineContext = {
        text,
        fileNames,
        dictionaryRules: input.dictionaryRaw,
        detectedLanguage: detectedLang,
        directoryHandle: input.directoryHandle,
        ...(resumedAssignments && { assignments: resumedAssignments }),
        ...(resumedVoiceMap && { voiceMap: resumedVoiceMap }),
        ...(resumedCharacters && { characters: resumedCharacters }),
      };

      // Set up progress callback
      pipeline.setProgressCallback((progress: PipelineProgress) => {
        this.handleProgress(progress);
      });

      // Set up pause callback for voice review after voice-remapping step
      pipeline.setPauseCallback(StepNames.VOICE_REMAPPING, async (ctx: PipelineContext) => {
        // Store characters and voice map for the review UI
        if (ctx.characters) {
          this.callbacks.onCharactersReady(ctx.characters);
        }
        if (ctx.voiceMap) {
          this.callbacks.onVoiceMapReady(ctx.voiceMap);
        }
        if (ctx.assignments) {
          this.callbacks.onAssignmentsReady(ctx.assignments);
        }

        // Trigger review UI and wait for user
        const { voiceMap: reviewedVoiceMap, existingProfile } = await this.callbacks.awaitVoiceReview();

        // Re-remap assignments with user's voice choices
        const remappedAssignments = ctx.assignments?.map(a => ({
          ...a,
          voiceId: a.speaker === 'narrator'
            ? input.narratorVoice
            : reviewedVoiceMap.get(a.speaker) ?? input.narratorVoice,
        }));

        // Return context with updated voice map, re-mapped assignments, and existing profile
        return {
          ...ctx,
          voiceMap: reviewedVoiceMap,
          assignments: remappedAssignments,
          existingProfile,
        };
      });

      // Run the pipeline
      await pipeline.run(context, this.abortController.signal);

      // Complete
      this.callbacks.onConversionComplete();
      this.logger.info('Conversion complete!');

    } catch (error) {
      if (error instanceof AppError && error.isCancellation()) {
        this.callbacks.onConversionCancel();
        this.logger.info('Conversion cancelled');
      } else if ((error as Error).message === 'Pipeline cancelled') {
        this.callbacks.onConversionCancel();
        this.logger.info('Conversion cancelled');
      } else if ((error as Error).message === 'Voice review cancelled') {
        this.callbacks.onConversionCancel();
        this.logger.info('Conversion cancelled by user during voice review');
      } else {
        const appError = AppError.fromUnknown(error);
        this.callbacks.onError(appError.message, appError.code);
        this.callbacks.setLLMError(appError.message);
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
    this.callbacks.resetLLMState();
    this.callbacks.onConversionCancel();
    this.logger.info('Conversion cancelled by user');
  }

  /**
   * Handle progress updates from pipeline steps
   */
  private handleProgress(progress: PipelineProgress): void {
    this.logger.info(progress.message);
    this.callbacks.onProgress(progress);

    // Update store status based on step
    switch (progress.step) {
      case StepNames.CHARACTER_EXTRACTION:
        this.callbacks.onStatusChange('llm-extract');
        this.callbacks.onLLMProcessingStatus('extracting');
        this.callbacks.onLLMBlockProgress(progress.current, progress.total);
        break;

      case StepNames.VOICE_ASSIGNMENT:
      case StepNames.VOICE_REMAPPING:
      case StepNames.TEXT_SANITIZATION:
      case StepNames.DICTIONARY_PROCESSING:
      case StepNames.SAVE:
        // Short steps, no special status
        break;

      case StepNames.SPEAKER_ASSIGNMENT:
        this.callbacks.onStatusChange('llm-assign');
        this.callbacks.onLLMProcessingStatus('assigning');
        this.callbacks.onLLMBlockProgress(progress.current, progress.total);
        break;

      case StepNames.TTS_CONVERSION:
        this.callbacks.onStatusChange('converting');
        this.callbacks.onLLMProcessingStatus('idle');
        this.callbacks.onConversionProgress(progress.current, progress.total);
        break;

      case StepNames.AUDIO_MERGE:
        this.callbacks.onStatusChange('merging');
        this.callbacks.onConversionProgress(progress.current, progress.total);
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
  callbacks: OrchestratorCallbacks
): ConversionOrchestrator {
  return new ConversionOrchestrator(container, callbacks);
}
