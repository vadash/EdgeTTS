// Conversion Orchestrator - Plain function orchestrator
// Runs the TTS conversion workflow as a single async function

import type { LLMServiceFactoryOptions } from './llm/LLMVoiceService';
import type {
  TTSConfig,
  LLMCharacter,
  SpeakerAssignment,
  VoiceProfileFile,
  VoicePool,
  ProcessedBook,
} from '@/state/types';
import type { Stores } from '@/stores';
import { allocateByGender, allocateByFrequency, remapAssignments, shortVoiceId } from './VoiceAllocator';
import { exportToProfile } from './llm/VoiceProfile';
import { withPermissionRetry } from '@/utils/retry';
import { checkResumeState, loadPipelineState } from './ResumeCheck';
import { AppError, noContentError, insufficientVoicesError, getErrorMessage } from '@/errors';

// Import concrete service classes
import type { Logger } from './Logger';
import type { TextBlockSplitter } from './TextBlockSplitter';
import type { VoicePoolBuilder } from './VoicePoolBuilder';
import type { LLMVoiceService } from './llm/LLMVoiceService';
import type { TTSWorkerPool } from './TTSWorkerPool';
import type { AudioMerger } from './AudioMerger';
import type { FFmpegService } from './FFmpegService';

// ============================================================================
// Orchestrator Input Types
// ============================================================================

/**
 * Progress information from workflow stages
 */
export interface WorkflowProgress {
  stage: string;
  current: number;
  total: number;
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
  repeatPrompt?: boolean;
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

// ============================================================================
// Orchestrator Services Bundle
// ============================================================================

export interface ConversionOrchestratorServices {
  logger: Logger;
  textBlockSplitter: TextBlockSplitter;
  llmServiceFactory: {
    create(options: LLMServiceFactoryOptions): LLMVoiceService;
  };
  workerPoolFactory: {
    create(options: import('./TTSWorkerPool').WorkerPoolOptions): TTSWorkerPool;
  };
  audioMergerFactory: {
    create(config: import('./AudioMerger').MergerConfig): AudioMerger;
  };
  voicePoolBuilder: VoicePoolBuilder;
  ffmpegService: FFmpegService;
}

// ============================================================================
// Helper Functions (previously private methods)
// ============================================================================

function sanitizeText(text: string): string {
  let result = text;

  // 1. Horizontal rules → pause marker
  result = result.replace(/^[-*_]{3,}$/gm, '...');

  // 2. Markdown headers
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 3. Markdown bold/italic (longest first)
  result = result.replace(/\*{3}([^*]+)\*{3}/g, '$1');
  result = result.replace(/\*{2}([^*]+)\*{2}/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_{3}([^_]+)_{3}/g, '$1');
  result = result.replace(/_{2}([^_]+)_{2}/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // 4. Strikethrough
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // 5. Inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // 6. HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // 7. Special Unicode
  result = result.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 8. Control characters (except newlines, tabs)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 9. Remaining special characters
  result = result.replace(/[~|^]/g, '');
  result = result.replace(/\\/g, '/');
  result = result.replace(/&/g, ' and ');

  // 10. Multiple spaces
  result = result.replace(/  +/g, ' ');

  return result.trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyDictionaryRules(
  text: string,
  rules: string[],
  caseSensitive: boolean
): string {
  let result = text;

  for (const rule of rules) {
    // Regex rule: regex"pattern"="replacement"
    const regexMatch = rule.match(/^regex"(.*)"="(.*)"/);
    if (regexMatch) {
      try {
        const regex = new RegExp(regexMatch[1], 'g');
        const replacement = regexMatch[2].replace(/\\r/g, '\r').replace(/\\n/g, '\n');
        result = result.replace(regex, replacement);
      } catch {
        // Invalid regex - skip
      }
      continue;
    }

    if (rule.length === 0) continue;

    // Exact match: "pattern"="replacement"
    if (rule[0] === '"') {
      const matchArr = rule.trim().replaceAll('"', '').split('=');
      if (matchArr.length === 2) {
        if (caseSensitive) {
          result = result.replaceAll(matchArr[0], matchArr[1]);
        } else {
          try {
            const regex = new RegExp(escapeRegex(matchArr[0]), 'giu');
            result = result.replace(regex, matchArr[1]);
          } catch {
            // Invalid regex - skip
          }
        }
      }
      continue;
    }

    // Word boundary: pattern=replacement
    const matchArr = rule.trim().split('=');
    if (matchArr.length === 2) {
      try {
        const escaped = escapeRegex(matchArr[0]);
        const regex = new RegExp(`(^|\\s|\\p{P})${escaped}(?=\\p{P}|\\s|$)`, 'giu');
        result = result.replace(regex, `$1${matchArr[1]}`);
      } catch {
        // Invalid regex - skip
      }
    }
  }

  return result;
}

function sanitizeAssignments(assignments: SpeakerAssignment[]): SpeakerAssignment[] {
  return assignments.map((assignment) => ({
    ...assignment,
    text: sanitizeText(assignment.text),
  }));
}

function applyDictionaryToAssignments(
  assignments: SpeakerAssignment[],
  dictionaryRules: string[],
  caseSensitive: boolean
): SpeakerAssignment[] {
  if (!dictionaryRules || dictionaryRules.length === 0) {
    return assignments;
  }

  return assignments.map((assignment) => ({
    ...assignment,
    text: applyDictionaryRules(assignment.text, dictionaryRules, caseSensitive),
  }));
}

function extractFilename(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length > 0);
  if (firstLine) {
    const cleaned = firstLine.trim().slice(0, 50).replace(/[<>:"/\\|?*]/g, '_');
    return cleaned || 'audio';
  }
  return 'audio';
}

function extractBookName(fileNames?: Array<[string, number]>): string {
  if (!fileNames || fileNames.length === 0) {
    return 'book';
  }
  const [name] = fileNames[0];
  return name.replace(/\.[^.]+$/, '').slice(0, 50) || 'book';
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Pipeline cancelled');
  }
}

async function cleanupTemp(
  directoryHandle: FileSystemDirectoryHandle,
  logger: Logger
): Promise<void> {
  try {
    await directoryHandle.removeEntry('_temp_work', { recursive: true });
    logger.debug('Cleaned up temp directory');
  } catch (err) {
    logger.debug(`Cleanup skipped: ${(err as Error).message}`);
  }
}

function logVoiceSummary(
  characters: LLMCharacter[],
  assignments: SpeakerAssignment[],
  voiceMap: Map<string, string>,
  rareVoices: { male: string; female: string; unknown: string },
  uniqueCount: number,
  pool: VoicePool,
  narratorVoice: string,
  logger: Logger
): void {
  const frequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
    }
  }

  const poolSize = pool.male.length + pool.female.length;
  const uniqueSlots = Math.max(0, poolSize - 1 - 3);

  const sorted = [...characters].sort((a, b) => {
    const freqA = frequency.get(a.canonicalName) ?? 0;
    const freqB = frequency.get(b.canonicalName) ?? 0;
    return freqB - freqA;
  });

  const report = (msg: string) => logger.info(msg);

  report('');
  report('══════ Voice Assignment ══════');
  report(`Pool: ${poolSize} | Unique: ${uniqueSlots} | Rare: 3`);
  report('');

  const narratorLines = assignments.filter(a => a.speaker === 'narrator').length;
  report(`  N  NARRATOR              ${String(narratorLines).padStart(3)}  ${shortVoiceId(narratorVoice)}`);
  report('  ─────────────────────────────');

  for (let i = 0; i < sorted.length; i++) {
    const char = sorted[i];
    const lines = frequency.get(char.canonicalName) ?? 0;
    const voice = voiceMap.get(char.canonicalName) ?? '?';
    const isRare = i >= uniqueSlots;

    if (isRare && i === uniqueSlots && uniqueSlots > 0) {
      report('  ─────────────────────────────');
    }

    const genderChar = char.gender === 'male' ? 'M' : char.gender === 'female' ? 'F' : '?';
    const marker = isRare ? '*' : ' ';
    report(`${marker}${String(i + 1).padStart(2)}. ${(char.canonicalName.slice(0, 16) + '                ').slice(0, 16)} ${genderChar} ${String(lines).padStart(3)}  ${shortVoiceId(voice)}`);
  }

  if (sorted.length > uniqueSlots || sorted.length === 0) {
    report('  ─────────────────────────────');
    report('  *  RARE_MALE         M      ' + shortVoiceId(rareVoices.male));
    report('  *  RARE_FEMALE       F      ' + shortVoiceId(rareVoices.female));
    report('  *  RARE_UNKNOWN      ?      ' + shortVoiceId(rareVoices.unknown));
  }

  report('══════════════════════════════');
  report('');
}

async function saveVoiceProfile(
  directoryHandle: FileSystemDirectoryHandle,
  fileNames: Array<[string, number]>,
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string,
  existingProfile: VoiceProfileFile | null,
  logger: Logger
): Promise<void> {
  try {
    const bookName = extractBookName(fileNames);
    const fileName = `${bookName}.json`;

    await withPermissionRetry(directoryHandle, async () => {
      const bookFolder = await directoryHandle.getDirectoryHandle(bookName, { create: true });
      const json = exportToProfile(
        existingProfile ?? null,
        characters,
        voiceMap,
        assignments,
        narratorVoice,
        bookName
      );

      const fileHandle = await bookFolder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
    });

    logger.info(`Saved voice mapping: ${bookName}/${fileName}`);
  } catch {
    logger.warn('Could not save voice mapping');
  }
}

// ============================================================================
// Main Orchestrator Function
// ============================================================================

/**
 * Run the full TTS conversion workflow.
 * This is a pure orchestrator function with no internal state.
 * Cancellation is controlled via the external AbortSignal.
 */
export async function runConversion(
  services: ConversionOrchestratorServices,
  stores: Stores,
  signal: AbortSignal,
  input: OrchestratorInput,
  existingBook?: ProcessedBook | null
): Promise<void> {
  const { logger, textBlockSplitter, llmServiceFactory, workerPoolFactory, audioMergerFactory, voicePoolBuilder, ffmpegService } = services;
  const { conversion, llm, logs, data } = stores;

  // ==================== INPUT VALIDATION ====================
  if (!input.textContent.trim()) {
    throw noContentError();
  }

  if (!input.isLLMConfigured) {
    throw new AppError('LLM_NOT_CONFIGURED', 'LLM API key not configured');
  }

  const directoryHandle = input.directoryHandle;
  if (!directoryHandle) {
    throw new AppError('NO_DIRECTORY', 'Please select an output directory before converting');
  }

  // ==================== RESUME CHECK ====================
  const resumeInfo = await checkResumeState(directoryHandle, (msg) => logger.info(msg));

  let skipLLMSteps = false;
  let resumedAssignments: SpeakerAssignment[] | undefined;
  let resumedVoiceMap: Map<string, string> | undefined;
  let resumedCharacters: LLMCharacter[] | undefined;

  if (resumeInfo) {
    const confirmed = await conversion.awaitResumeConfirmation(resumeInfo);
    if (!confirmed) {
      conversion.cancel();
      logger.info('User cancelled resume, starting fresh');
      try {
        await directoryHandle.removeEntry('_temp_work', { recursive: true });
        logger.info('Cleaned up _temp_work directory');
      } catch {
        // Expected if no temp dir exists
      }
    } else if (resumeInfo.hasLLMState) {
      const pipelineState = await loadPipelineState(directoryHandle);
      if (pipelineState) {
        skipLLMSteps = true;
        resumedAssignments = pipelineState.assignments;
        resumedVoiceMap = new Map(Object.entries(pipelineState.characterVoiceMap));
        resumedCharacters = pipelineState.characters;
        logger.info('Resuming with cached LLM state');
      }
    }
  } else {
    // Fresh start - clean any leftover _temp_work
    try {
      await directoryHandle.removeEntry('_temp_work', { recursive: true });
      logger.info('Cleaned up _temp_work directory');
    } catch {
      // Expected if no temp dir exists
    }
  }

  // ==================== VOICE POOL VALIDATION ====================
  const pool = voicePoolBuilder.buildPool(input.detectedLanguage, input.enabledVoices);
  const totalVoices = pool.male.length + pool.female.length;
  if (totalVoices < 5 || pool.male.length < 2 || pool.female.length < 2) {
    throw insufficientVoicesError(pool.male.length, pool.female.length);
  }

  // ==================== INITIALIZATION ====================
  conversion.startConversion();
  logs.startTimer();
  llm.resetProcessingState();
  data.setTextContent('');
  data.setBook(null);

  logger.info(`Detected language: ${input.detectedLanguage.toUpperCase()}`);

  const text = input.textContent;
  const fileNames = existingBook?.fileNames ?? [[extractFilename(text), 0]] as Array<[string, number]>;

  // Progress reporter helper
  const report = (stage: string, current: number, total: number, message: string) => {
    logger.info(message);
    updateStatus(stage, stores);
  };

  let llmService: LLMVoiceService | null = null;

  try {
    // ==================== LLM STAGE 1: CHARACTER EXTRACTION ====================
    let characters: LLMCharacter[] | undefined;
    let voiceMap: Map<string, string> | undefined;

    if (!skipLLMSteps) {
      checkCancelled(signal);

      const extractLLMOptions: LLMServiceFactoryOptions = {
        apiKey: input.extractConfig.apiKey,
        apiUrl: input.extractConfig.apiUrl,
        model: input.extractConfig.model,
        narratorVoice: input.narratorVoice,
        streaming: input.extractConfig.streaming,
        reasoning: input.extractConfig.reasoning,
        temperature: input.extractConfig.temperature,
        topP: input.extractConfig.topP,
        repeatPrompt: input.extractConfig.repeatPrompt,
        maxConcurrentRequests: input.llmThreads,
        directoryHandle: input.directoryHandle,
        logger,
        mergeConfig: {
          apiKey: input.mergeConfig.apiKey,
          apiUrl: input.mergeConfig.apiUrl,
          model: input.mergeConfig.model,
          streaming: input.mergeConfig.streaming,
          reasoning: input.mergeConfig.reasoning,
          temperature: input.mergeConfig.temperature,
          topP: input.mergeConfig.topP,
          repeatPrompt: input.mergeConfig.repeatPrompt,
        },
      };

      const blocks = textBlockSplitter.createExtractBlocks(text);
      report('character-extraction', 0, blocks.length, '=== LLM Pass 1: Character Extraction ===');

      llmService = llmServiceFactory.create(extractLLMOptions);
      const abortHandler = () => llmService?.cancel();
      signal.addEventListener('abort', abortHandler);

      try {
        characters = await llmService.extractCharacters(blocks, (current, total, message) => {
          report('character-extraction', current, total, message ?? `Extract: Block ${current}/${total}`);
        });
        report('character-extraction', blocks.length, blocks.length, `Detected ${characters.length} character(s)`);
      } finally {
        signal.removeEventListener('abort', abortHandler);
        llmService = null;
      }

      // ==================== VOICE ASSIGNMENT (initial) ====================
      checkCancelled(signal);
      const initialAllocation = allocateByGender(characters, {
        narratorVoice: input.narratorVoice,
        pool,
      });
      voiceMap = initialAllocation.voiceMap;
      report('voice-assignment', characters.length, characters.length,
        `Assigned ${initialAllocation.uniqueCount} voice(s) to ${characters.length} character(s)`);

      // ==================== LLM STAGE 2: SPEAKER ASSIGNMENT ====================
      checkCancelled(signal);

      const assignLLMOptions: LLMServiceFactoryOptions = {
        apiKey: input.assignConfig.apiKey,
        apiUrl: input.assignConfig.apiUrl,
        model: input.assignConfig.model,
        narratorVoice: input.narratorVoice,
        streaming: input.assignConfig.streaming,
        reasoning: input.assignConfig.reasoning,
        temperature: input.assignConfig.temperature,
        topP: input.assignConfig.topP,
        repeatPrompt: input.assignConfig.repeatPrompt,
        useVoting: input.useVoting,
        maxConcurrentRequests: input.llmThreads,
        directoryHandle: input.directoryHandle,
        logger,
      };

      const assignBlocks = textBlockSplitter.createAssignBlocks(text);
      report('speaker-assignment', 0, assignBlocks.length, '=== LLM Pass 2: Speaker Assignment ===');

      llmService = llmServiceFactory.create(assignLLMOptions);
      signal.addEventListener('abort', abortHandler);

      let assignments: SpeakerAssignment[];

      try {
        assignments = await llmService.assignSpeakers(
          assignBlocks,
          voiceMap,
          characters,
          (current, total) => {
            report('speaker-assignment', current, total, `Assign: Block ${current}/${total}`);
          }
        );
        report('speaker-assignment', assignBlocks.length, assignBlocks.length,
          `Assigned speakers to ${assignments.length} sentence(s)`);

        // Save pipeline state for resume
        let tempDirHandle: FileSystemDirectoryHandle | null = null;
        try {
          tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work', { create: true });
          const stateFile = await tempDirHandle.getFileHandle('pipeline_state.json', { create: true });
          const writable = await stateFile.createWritable();
          await writable.write(JSON.stringify({
            assignments,
            characterVoiceMap: Object.fromEntries(voiceMap),
            characters,
            fileNames,
          }));
          await writable.close();
          report('speaker-assignment', assignBlocks.length, assignBlocks.length, 'Saved pipeline state for resume');
        } catch {
          // Non-fatal
        }
      } finally {
        signal.removeEventListener('abort', abortHandler);
        llmService = null;
      }

      // ==================== VOICE REMAPPING (by frequency) ====================
      checkCancelled(signal);

      const frequencyAllocation = allocateByFrequency(characters, assignments, {
        narratorVoice: input.narratorVoice,
        pool,
      });
      voiceMap = frequencyAllocation.voiceMap;
      assignments = remapAssignments(assignments, voiceMap, input.narratorVoice);

      logVoiceSummary(characters, assignments, voiceMap, frequencyAllocation.rareVoices,
        frequencyAllocation.uniqueCount, pool, input.narratorVoice, logger);

      // ==================== VOICE REVIEW PAUSE ====================
      checkCancelled(signal);

      llm.setCharacters(characters);
      llm.setVoiceMap(voiceMap);
      llm.setSpeakerAssignments(assignments);

      llm.setPendingReview(true);
      await llm.awaitReview();
      const reviewedVoiceMap = llm.characterVoiceMap.value;
      const existingProfile = llm.loadedProfile.value;

      assignments = assignments.map(a => ({
        ...a,
        voiceId: a.speaker === 'narrator'
          ? input.narratorVoice
          : reviewedVoiceMap.get(a.speaker) ?? input.narratorVoice,
      }));

      checkCancelled(signal);

      // ==================== SAVE VOICE PROFILE ====================
      await saveVoiceProfile(directoryHandle, fileNames, characters, reviewedVoiceMap, assignments,
        input.narratorVoice, existingProfile, logger);

      // ==================== TEXT SANITIZATION ====================
      checkCancelled(signal);
      assignments = sanitizeAssignments(assignments);
      report('text-sanitization', assignments.length, assignments.length, 'Text sanitization complete');

      // ==================== DICTIONARY PROCESSING ====================
      checkCancelled(signal);
      assignments = applyDictionaryToAssignments(assignments, input.dictionaryRaw, input.lexxRegister);
      report('dictionary-processing', assignments.length, assignments.length, 'Dictionary processing complete');

      // Continue to TTS with assignments
      await runTTSStage(input, assignments, fileNames, signal, report, services, stores);

    } else {
      // ==================== RESUME MODE - SKIP LLM ====================
      characters = resumedCharacters!;
      voiceMap = resumedVoiceMap!;
      const assignments = resumedAssignments!;

      llm.setCharacters(characters);
      llm.setVoiceMap(voiceMap);
      llm.setSpeakerAssignments(assignments);

      llm.setPendingReview(true);
      await llm.awaitReview();
      const reviewedVoiceMap = llm.characterVoiceMap.value;
      const existingProfile = llm.loadedProfile.value;
      const remappedAssignments = assignments.map(a => ({
        ...a,
        voiceId: a.speaker === 'narrator'
          ? input.narratorVoice
          : reviewedVoiceMap.get(a.speaker) ?? input.narratorVoice,
      }));

      await saveVoiceProfile(directoryHandle, fileNames, characters, reviewedVoiceMap, remappedAssignments,
        input.narratorVoice, existingProfile, logger);

      const sanitized = sanitizeAssignments(remappedAssignments);
      const withDictionary = applyDictionaryToAssignments(sanitized, input.dictionaryRaw, input.lexxRegister);

      await runTTSStage(input, withDictionary, fileNames, signal, report, services, stores);
    }

    // ==================== COMPLETE ====================
    conversion.complete();
    logger.info('Conversion complete!');

  } catch (error) {
    if (error instanceof AppError && error.isCancellation()) {
      conversion.cancel();
      logger.info('Conversion cancelled');
    } else if ((error as Error).message === 'Pipeline cancelled' || (error as Error).message === 'Voice review cancelled') {
      conversion.cancel();
      logger.info('Conversion cancelled');
    } else {
      const appError = AppError.fromUnknown(error);
      conversion.setError(appError.message, appError.code);
      llm.setError(appError.message);
      logger.error('Conversion failed', appError);
      throw appError;
    }
  }
}

// ============================================================================
// TTS Stage (extracted for reuse)
// ============================================================================

async function runTTSStage(
  input: OrchestratorInput,
  assignments: SpeakerAssignment[],
  fileNames: Array<[string, number]>,
  signal: AbortSignal,
  report: (stage: string, current: number, total: number, message: string) => void,
  services: ConversionOrchestratorServices,
  stores: Stores
): Promise<void> {
  const { logger, workerPoolFactory, audioMergerFactory, ffmpegService } = services;
  const { conversion, llm } = stores;

  const directoryHandle = input.directoryHandle!;

  // ==================== TTS CONVERSION ====================
  checkCancelled(signal);

  const chunks = assignments
    .filter(a => /[\p{L}\p{N}]/u.test(a.text))
    .map((a, index) => ({
      text: a.text,
      voice: a.voiceId,
      partIndex: index,
      speaker: a.speaker,
    }));

  if (chunks.length === 0) {
    throw new Error('No pronounceable content to convert');
  }

  report('tts-conversion', 0, chunks.length, `Converting ${chunks.length} chunks to audio...`);

  const ttsConfig: TTSConfig = {
    voice: `Microsoft Server Speech Text to Speech Voice (${input.voice})`,
    pitch: input.pitch >= 0 ? `+${input.pitch}Hz` : `${input.pitch}Hz`,
    rate: input.rate >= 0 ? `+${input.rate}%` : `${input.rate}%`,
    volume: '+0%',
  };

  const audioMap = new Map<number, string>();
  const failedTasks = new Set<number>();
  let tempDirHandle: FileSystemDirectoryHandle | null = null;

  // Pre-scan for cached chunks
  try {
    tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work');
  } catch {
    // No temp dir yet
  }

  if (tempDirHandle) {
    for (const chunk of chunks) {
      const filename = `chunk_${String(chunk.partIndex).padStart(6, '0')}.bin`;
      try {
        const handle = await tempDirHandle.getFileHandle(filename);
        const file = await handle.getFile();
        if (file.size > 0) {
          audioMap.set(chunk.partIndex, filename);
        }
      } catch {
        // File doesn't exist
      }
    }

    if (audioMap.size > 0) {
      report('tts-conversion', audioMap.size, chunks.length,
        `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`);
    }
  }

  const remainingChunks = chunks.filter(c => !audioMap.has(c.partIndex));

  if (remainingChunks.length > 0) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Pipeline cancelled'));
        return;
      }

      const workerPool = workerPoolFactory.create({
        maxWorkers: input.ttsThreads,
        config: ttsConfig,
        directoryHandle: directoryHandle,
        onStatusUpdate: (update) => {
          if (update.message.includes('Retry')) {
            report('tts-conversion', audioMap.size, chunks.length, update.message);
          }
        },
        onTaskComplete: (partIndex) => {
          audioMap.set(partIndex, `chunk_${String(partIndex).padStart(6, '0')}.bin`);
          const completed = audioMap.size;
          const percentageInterval = Math.max(1, Math.floor(chunks.length * 0.01));
          const minInterval = 50;
          const maxInterval = 500;
          const step = 50;
          const clampedInterval = Math.max(minInterval, Math.min(percentageInterval, maxInterval));
          const reportInterval = Math.round(clampedInterval / step) * step;
          const finalInterval = Math.max(minInterval, Math.min(reportInterval, maxInterval));

          if (completed % finalInterval === 0 || completed === chunks.length) {
            report('tts-conversion', completed, chunks.length, `Written ${completed}/${chunks.length} files`);
          }
        },
        onTaskError: (partIndex, error) => {
          failedTasks.add(partIndex);
          report('tts-conversion', audioMap.size, chunks.length,
            `Part ${partIndex + 1} failed: ${getErrorMessage(error)}`);
        },
        onAllComplete: () => {
          resolve();
        },
      });

      const abortHandler = () => workerPool.clear();
      signal.addEventListener('abort', abortHandler);

      workerPool.addTasks(remainingChunks.map((chunk) => {
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
      }));

      signal.removeEventListener('abort', abortHandler);
    });

    tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work');
  }

  // ==================== AUDIO MERGE ====================
  checkCancelled(signal);

  if (audioMap.size === 0) {
    report('audio-merge', 1, 1, 'No audio to merge');
    await cleanupTemp(directoryHandle, logger);
    return;
  }

  report('audio-merge', 0, 1, 'Loading FFmpeg for Opus encoding...');

  const loaded = await ffmpegService.load((msg) => {
    report('audio-merge', 0, 1, msg);
  });

  if (!loaded) {
    throw new Error('FFmpeg failed to load. Cannot encode to Opus.');
  }

  checkCancelled(signal);

  const merger = audioMergerFactory.create({
    outputFormat: 'opus',
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
  });

  const totalChunks = audioMap.size;
  report('audio-merge', 0, totalChunks, 'Merging audio...');

  const savedCount = await merger.mergeAndSave(
    audioMap,
    totalChunks,
    fileNames,
    tempDirHandle!,
    directoryHandle,
    (current, total, message) => {
      report('audio-merge', current, total, message);
    }
  );

  report('audio-merge', totalChunks, totalChunks, `Saved ${savedCount} file(s)`);

  // ==================== CLEANUP ====================
  await cleanupTemp(directoryHandle, logger);
}

// ============================================================================
// Status Update Helper
// ============================================================================

function updateStatus(stage: string, stores: Stores): void {
  const { conversion, llm } = stores;
  switch (stage) {
    case 'character-extraction':
      conversion.setStatus('llm-extract');
      llm.setProcessingStatus('extracting');
      break;
    case 'speaker-assignment':
      conversion.setStatus('llm-assign');
      llm.setProcessingStatus('assigning');
      break;
    case 'tts-conversion':
      conversion.setStatus('converting');
      llm.setProcessingStatus('idle');
      conversion.updateProgress(0, 0);
      break;
    case 'audio-merge':
      conversion.setStatus('merging');
      break;
  }
}
