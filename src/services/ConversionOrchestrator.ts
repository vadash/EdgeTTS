// Conversion Orchestrator
// Manages the full TTS conversion workflow with proper separation of concerns

import type { ServiceContainer } from '@/di/ServiceContainer';
import { ServiceTypes } from '@/di/ServiceContainer';
import type { Stores } from '@/stores';
import type { ILogger, IFFmpegService } from '@/services/interfaces';
import type { TTSConfig, ProcessedBook, SpeakerAssignment } from '@/state/types';
import { TTSWorkerPool, PoolTask } from './TTSWorkerPool';
import { AudioMerger } from './AudioMerger';
import { LLMVoiceService } from './LLMVoiceService';
import { TextBlockSplitter } from './TextBlockSplitter';
import { VoiceAssigner } from './VoiceAssigner';
import { AppError, conversionCancelledError, noContentError } from '@/errors';

/**
 * Voice annotated chunk for TTS
 */
interface VoiceAnnotatedChunk {
  text: string;
  voice: string;
  partIndex: number;
  speaker: string;
}

/**
 * Orchestrates the full TTS conversion workflow:
 * 1. LLM Pass 1 - Character extraction
 * 2. Voice assignment
 * 3. LLM Pass 2 - Speaker assignment
 * 4. TTS conversion
 * 5. Audio merge & save
 */
export class ConversionOrchestrator {
  private abortController: AbortController | null = null;
  private logger: ILogger;
  private ffmpegService: IFFmpegService;
  private pool: TTSWorkerPool | null = null;

  constructor(
    private container: ServiceContainer,
    private stores: Stores
  ) {
    this.logger = container.get<ILogger>(ServiceTypes.Logger);
    this.ffmpegService = container.get<IFFmpegService>(ServiceTypes.FFmpegService);
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

    const fileNames = existingBook?.fileNames ?? [[this.extractFilename(text), 0]];

    try {
      // Step 1: LLM Pass 1 - Character extraction
      this.logger.info('Starting LLM character extraction (Pass 1)...');
      this.stores.conversion.setStatus('llm-pass1');
      this.stores.llm.setProcessingStatus('pass1');

      const characters = await this.runLLMPass1(text);
      this.stores.llm.setCharacters(characters);

      // Assign voices
      const assigner = VoiceAssigner.createWithFilteredPool(
        this.stores.settings.narratorVoice.value,
        this.stores.data.detectedLanguage.value
      );
      const voiceMap = assigner.assignVoicesFromLLMCharacters(characters);
      this.stores.llm.setVoiceMap(voiceMap);

      this.logger.info(`Detected ${characters.length} character(s)`);
      for (const char of characters) {
        const voice = voiceMap.get(char.canonicalName);
        this.logger.info(`  - ${char.canonicalName} (${char.gender}): ${voice}`);
      }

      // Check for cancellation
      this.checkCancelled();

      // Step 2: LLM Pass 2 - Speaker assignment
      this.logger.info('Starting LLM speaker assignment (Pass 2)...');
      this.stores.conversion.setStatus('llm-pass2');
      this.stores.llm.setProcessingStatus('pass2');

      const assignments = await this.runLLMPass2(
        text,
        voiceMap,
        characters.map(c => c.canonicalName)
      );

      this.logger.info(`Assigned speakers to ${assignments.length} sentence(s)`);

      // Check for cancellation
      this.checkCancelled();

      // Apply dictionary processing
      const processedAssignments = this.applyDictionaryToAssignments(assignments);

      // Step 3: TTS Conversion
      this.logger.info('Starting TTS conversion...');
      this.stores.conversion.setStatus('converting');
      this.stores.llm.setProcessingStatus('idle');

      const audioMap = await this.runTTSConversion(processedAssignments, fileNames);

      // Check for cancellation
      this.checkCancelled();

      // Step 4: Merge & Save
      this.logger.info('Merging and saving audio...');
      this.stores.conversion.setStatus('merging');

      await this.mergeAndSave(audioMap, processedAssignments.length, fileNames);

      // Complete
      this.stores.conversion.complete();
      this.logger.info('Conversion complete!');

    } catch (error) {
      if (error instanceof AppError && error.isCancellation()) {
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
    this.pool?.clear();
    this.stores.llm.resetProcessingState();
    this.stores.conversion.cancel();
    this.logger.info('Conversion cancelled by user');
  }

  /**
   * Check if cancelled and throw if so
   */
  private checkCancelled(): void {
    if (this.abortController?.signal.aborted) {
      throw conversionCancelledError();
    }
  }

  /**
   * Run LLM Pass 1: Character extraction
   */
  private async runLLMPass1(text: string) {
    const llmService = new LLMVoiceService({
      apiKey: this.stores.llm.apiKey.value,
      apiUrl: this.stores.llm.apiUrl.value,
      model: this.stores.llm.model.value,
      narratorVoice: this.stores.settings.narratorVoice.value,
      directoryHandle: this.stores.data.directoryHandle.value,
    });

    // Cancel LLM if we get aborted
    this.abortController?.signal.addEventListener('abort', () => {
      llmService.cancel();
    });

    const splitter = new TextBlockSplitter();
    const blocks = splitter.createPass1Blocks(text);

    this.stores.llm.setBlockProgress(0, blocks.length);
    this.logger.info(`Processing ${blocks.length} block(s)...`);

    const characters = await llmService.extractCharacters(blocks, (current, total) => {
      this.stores.llm.setBlockProgress(current, total);
      this.logger.info(`Pass 1: Block ${current}/${total}`);
    });

    return characters;
  }

  /**
   * Run LLM Pass 2: Speaker assignment
   */
  private async runLLMPass2(
    text: string,
    voiceMap: Map<string, string>,
    characterNames: string[]
  ) {
    const llmService = new LLMVoiceService({
      apiKey: this.stores.llm.apiKey.value,
      apiUrl: this.stores.llm.apiUrl.value,
      model: this.stores.llm.model.value,
      narratorVoice: this.stores.settings.narratorVoice.value,
      directoryHandle: this.stores.data.directoryHandle.value,
    });

    // Cancel LLM if we get aborted
    this.abortController?.signal.addEventListener('abort', () => {
      llmService.cancel();
    });

    const splitter = new TextBlockSplitter();
    const blocks = splitter.createPass2Blocks(text);

    this.stores.llm.setBlockProgress(0, blocks.length);

    const assignments = await llmService.assignSpeakers(
      blocks,
      voiceMap,
      characterNames,
      (current, total) => {
        this.stores.llm.setBlockProgress(current, total);
        this.logger.info(`Pass 2: Block ${current}/${total}`);
      }
    );

    return assignments;
  }

  /**
   * Run TTS conversion with speaker assignments
   */
  private async runTTSConversion(
    assignments: SpeakerAssignment[],
    fileNames: Array<[string, number]>
  ): Promise<Map<number, Uint8Array>> {
    // Filter out empty sentences
    const chunks: VoiceAnnotatedChunk[] = assignments
      .filter(a => /[\p{L}\p{N}]/u.test(a.text))
      .map((a, index) => ({
        text: a.text,
        voice: a.voiceId,
        partIndex: index,
        speaker: a.speaker,
      }));

    if (chunks.length === 0) {
      throw noContentError();
    }

    this.stores.conversion.updateProgress(0, chunks.length);
    this.logger.info(`Converting ${chunks.length} chunks to audio...`);

    const config = this.buildTTSConfig();
    const audioMap = new Map<number, Uint8Array>();

    return new Promise((resolve, reject) => {
      this.pool = new TTSWorkerPool({
        maxWorkers: this.stores.settings.maxThreads.value,
        config: config,
        onStatusUpdate: (update) => {
          this.logger.info(update.message);
        },
        onTaskComplete: (partIndex, audioData) => {
          audioMap.set(partIndex, audioData);
          this.stores.conversion.incrementProgress();
        },
        onTaskError: (partIndex, error) => {
          this.logger.warn(`Part ${partIndex + 1} failed: ${error.message}`);
          this.stores.conversion.incrementProgress();
        },
        onAllComplete: () => {
          resolve(audioMap);
        },
      });

      // Build tasks
      const tasks: PoolTask[] = chunks.map((chunk) => {
        let filename = fileNames[0]?.[0] ?? 'audio';
        for (const [name, boundaryIndex] of fileNames) {
          if (chunk.partIndex >= boundaryIndex && boundaryIndex > 0) {
            filename = name;
          }
        }

        return {
          partIndex: chunk.partIndex,
          text: chunk.text,
          filename: filename,
          filenum: String(chunk.partIndex + 1).padStart(4, '0'),
          voice: chunk.voice,
        };
      });

      this.pool.addTasks(tasks);
    });
  }

  /**
   * Merge audio and save to directory
   */
  private async mergeAndSave(
    audioMap: Map<number, Uint8Array>,
    totalChunks: number,
    fileNames: Array<[string, number]>
  ): Promise<void> {
    // Load FFmpeg if using Opus
    const outputFormat = this.stores.settings.outputFormat.value;

    if (outputFormat === 'opus') {
      this.stores.conversion.setFFmpegLoading(true);
      this.logger.info('Loading FFmpeg for Opus encoding...');

      const loaded = await this.ffmpegService.load((msg) => {
        this.logger.info(msg);
      });

      this.stores.conversion.setFFmpegLoaded(loaded);

      if (!loaded) {
        const error = this.ffmpegService.getLoadError();
        this.stores.conversion.setFFmpegError(error);
        this.logger.warn('FFmpeg not available, falling back to MP3 output');
      }
    }

    const useOpus = this.stores.conversion.ffmpegLoaded.value && outputFormat === 'opus';

    const merger = new AudioMerger({
      outputFormat: useOpus ? 'opus' : 'mp3',
      silenceRemoval: this.stores.settings.silenceRemovalEnabled.value,
      normalization: this.stores.settings.normalizationEnabled.value,
    });

    const mergedFiles = await merger.merge(
      audioMap,
      totalChunks,
      fileNames,
      (current, total, message) => {
        this.logger.info(message);
      }
    );

    if (mergedFiles.length === 0) {
      this.logger.warn('No audio files to merge');
      return;
    }

    this.logger.info(`Saving ${mergedFiles.length} merged file(s)...`);
    await merger.saveMergedFiles(mergedFiles, this.stores.data.directoryHandle.value);

    const failedCount = this.pool?.getFailedTasks().size ?? 0;
    if (failedCount > 0) {
      this.logger.warn(`Complete with ${failedCount} failed chunks`);
    }
  }

  /**
   * Build TTS config from settings
   */
  private buildTTSConfig(): TTSConfig {
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

  /**
   * Apply dictionary rules to assignments
   */
  private applyDictionaryToAssignments(
    assignments: SpeakerAssignment[]
  ): SpeakerAssignment[] {
    const dictionaryRaw = this.stores.data.dictionaryRaw.value;

    if (dictionaryRaw.length === 0) {
      return assignments;
    }

    return assignments.map(a => ({
      ...a,
      text: this.applyDictionaryRules(a.text, dictionaryRaw),
    }));
  }

  /**
   * Apply dictionary rules to text
   */
  private applyDictionaryRules(text: string, rules: string[]): string {
    let result = text;
    const lexxRegister = this.stores.settings.lexxRegister.value;

    // Sanitize
    result = result.replace(/[~|*^]/g, '-');
    result = result.replace(/\\/g, '/');
    result = result.replace(/&/g, ' and ');
    result = result.replace(/</g, '(');
    result = result.replace(/>/g, ')');

    // Apply rules
    for (const rule of rules) {
      const regexMatch = rule.match(/^regex"(.*)"="(.*)"/);
      if (regexMatch) {
        const regex = new RegExp(regexMatch[1], 'g');
        const replacement = regexMatch[2].replace(/\\r/g, '\r').replace(/\\n/g, '\n');
        result = result.replace(regex, replacement);
      } else if (rule.length > 0) {
        if (rule[0] === '"') {
          const matchArr = rule.trim().replaceAll('"', '').split('=');
          if (matchArr.length === 2) {
            if (lexxRegister) {
              result = result.replaceAll(matchArr[0], matchArr[1]);
            } else {
              const regex = new RegExp(this.escapeRegex(matchArr[0]), 'giu');
              result = result.replace(regex, matchArr[1]);
            }
          }
        } else {
          const matchArr = rule.trim().split('=');
          if (matchArr.length === 2) {
            const escaped = this.escapeRegex(matchArr[0]);
            const regex = new RegExp(`(^|\\s|\\p{P})${escaped}(?=\\p{P}|\\s|$)`, 'giu');
            result = result.replace(regex, `$1${matchArr[1]}`);
          }
        }
      }
    }

    return result;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
