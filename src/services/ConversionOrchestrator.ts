// Conversion Orchestrator - Plain function orchestrator
// Runs the TTS conversion workflow as a single async function

import { defaultConfig } from '@/config';
import {
  AppError,
  getErrorMessage,
  insufficientVoicesError,
  noContentError,
  throwIfAborted,
} from '@/errors';
import type {
  AudioSettings,
  LLMCharacter,
  ProcessedBook,
  SpeakerAssignment,
  StageConfig,
  StageId,
  TTSConfig,
  VoicePool,
  VoiceProfileFile,
} from '@/state/types';
import { sanitizeFilename } from '@/utils/file';
import { withPermissionRetry } from '@/utils/retry';
import { sanitizeText } from '@/utils/text';
import type { AudioMerger, MergerConfig } from './AudioMerger';
import type { ChunkStore } from './ChunkStore';
import { FailureLog } from './FailureLog';
import type { FFmpegService } from './FFmpegService';
// Import concrete service classes
import type { ILogger } from './Logger';
import type { LlmStageDeps, LlmStages } from './llm/stages';
import { exportToProfile } from './llm/VoiceProfile';
import {
  checkResumeState,
  loadPipelineState,
  type ResumeInfo,
  savePipelineState,
} from './ResumeCheck';
import type { TextBlockSplitter } from './TextBlockSplitter';
import type { TTSWorkerPool, WorkerPoolOptions } from './TTSWorkerPool';
import {
  allocateByGender,
  allocateTieredVoices,
  remapAssignments,
  shortVoiceId,
} from './VoiceAllocator';
import type { VoicePoolBuilder } from './VoicePoolBuilder';

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
 * Input configuration snapshot -- read once at the start of run().
 * Replaces all signal .value reads.
 */
export interface OrchestratorInput {
  // LLM config
  isLLMConfigured: boolean;
  extractConfig: StageConfig;
  mergeConfig: StageConfig;
  assignConfig: StageConfig;
  backupConfig: StageConfig;
  useVoting: boolean;

  // Settings
  narratorVoice: string;
  pitch: number;
  rate: number;
  ttsThreads: number;
  llmThreads: number;
  enabledVoices: string[];
  lexxRegister: boolean;
  outputFormat: 'opus';
  audio: AudioSettings;

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
  logger: ILogger;
  textBlockSplitter: TextBlockSplitter;
  llmStagesFactory: {
    create(deps: LlmStageDeps): LlmStages;
  };
  workerPoolFactory: {
    create(options: WorkerPoolOptions): TTSWorkerPool;
  };
  audioMergerFactory: {
    create(config: MergerConfig): AudioMerger;
  };
  voicePoolBuilder: VoicePoolBuilder;
  ffmpegService: FFmpegService;
  chunkStoreFactory: {
    create(): ChunkStore;
  };
}

// ============================================================================
// Orchestrator Ports
// ============================================================================

/**
 * Progress reporting seam. The adapter projects StageId onto the
 * conversion/LLM status stores via STAGE_STATUS and mirrors the numbers
 * into ConversionStore progress state.
 */
export interface ProgressReporter {
  report(stage: StageId, current: number, total: number, message: string, failed?: number): void;
  setConcurrency(llm: number, tts: number): void;
  setPhaseBaseline(count: number): void;
}

/** Voice review pause: pushes data, awaits user review, returns the result. */
export interface ReviewGate {
  open(
    characters: LLMCharacter[],
    voiceMap: Map<string, string>,
    assignments: SpeakerAssignment[],
  ): Promise<{ voiceMap: Map<string, string>; profile: VoiceProfileFile | null }>;
}

/** Resume confirmation prompt. */
export interface ResumeGate {
  confirm(info: ResumeInfo): Promise<boolean>;
}

/** Run lifecycle: begin/end bookkeeping, cancellation, and failure surface. */
export interface RunControl {
  begin(): void;
  complete(): void;
  cancel(): void;
  fail(message: string, code?: string): void;
}

/** Pushes LLM results into the UI stores (resume path; review handles fresh). */
export interface CharacterDataSink {
  push(
    characters: LLMCharacter[],
    voiceMap: Map<string, string>,
    assignments: SpeakerAssignment[],
  ): void;
}

export interface ConversionPorts {
  progress: ProgressReporter;
  review: ReviewGate;
  resume: ResumeGate;
  run: RunControl;
  characters: CharacterDataSink;
}

// ============================================================================
// Helper Functions (previously private methods)
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyDictionaryRules(text: string, rules: string[], caseSensitive: boolean): string {
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
  caseSensitive: boolean,
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
  const firstLine = text.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) {
    const cleaned = firstLine
      .trim()
      .slice(0, 50)
      .replace(/[<>:"/\\|?*]/g, '_');
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
  throwIfAborted(signal);
}

function logVoiceSummary(
  characters: LLMCharacter[],
  assignments: SpeakerAssignment[],
  voiceMap: Map<string, string>,
  rareVoices: { male: string; female: string; unknown: string },
  _uniqueCount: number,
  pool: VoicePool,
  narratorVoice: string,
  logger: ILogger,
): void {
  const frequency = new Map<string, number>();
  for (const a of assignments) {
    if (a.speaker !== 'narrator') {
      frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
    }
  }

  const poolSize = pool.male.length + pool.female.length;
  const topPercent = Math.round(defaultConfig.llm.topSpeakerPoolPercent * 100);
  const uniqueSlots = Math.max(1, Math.ceil(defaultConfig.llm.topSpeakerPoolPercent * poolSize));

  const sorted = [...characters].sort((a, b) => {
    const freqA = frequency.get(a.canonicalName) ?? 0;
    const freqB = frequency.get(b.canonicalName) ?? 0;
    return freqB - freqA;
  });

  const report = (msg: string) => logger.info(msg);

  report('');
  report('══════ Voice Assignment ══════');
  report(`Pool: ${poolSize} | Top ${topPercent}%: ${uniqueSlots} unique | Cycle: rest`);
  report('');

  const narratorLines = assignments.filter((a) => a.speaker === 'narrator').length;
  report(
    `  N  NARRATOR              ${String(narratorLines).padStart(3)}  ${shortVoiceId(narratorVoice)}`,
  );
  report('  ─────────────────────────────');

  for (let i = 0; i < sorted.length; i++) {
    const char = sorted[i];
    const lines = frequency.get(char.canonicalName) ?? 0;
    const voice = voiceMap.get(char.canonicalName) ?? '?';
    const isTop = i < uniqueSlots;

    if (i === uniqueSlots && uniqueSlots > 0 && uniqueSlots < sorted.length) {
      report('  ─────────────────────────────');
    }

    const genderChar = char.gender === 'male' ? 'M' : char.gender === 'female' ? 'F' : '?';
    const marker = isTop ? '✓' : '↺';
    report(
      `${marker}${String(i + 1).padStart(2)}. ${(`${char.canonicalName.slice(0, 16)}                `).slice(0, 16)} ${genderChar} ${String(lines).padStart(3)}  ${shortVoiceId(voice)}`,
    );
  }

  report('  ─────────────────────────────');
  report(`  ↺  CYCLE_MALE        M      ${shortVoiceId(rareVoices.male)}`);
  report(`  ↺  CYCLE_FEMALE      F      ${shortVoiceId(rareVoices.female)}`);
  report(`  ↺  CYCLE_UNKNOWN     ?      ${shortVoiceId(rareVoices.unknown)}`);

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
  logger: ILogger,
): Promise<void> {
  try {
    const bookName = sanitizeFilename(extractBookName(fileNames));
    const fileName = `${bookName}.json`;

    await withPermissionRetry(directoryHandle, async () => {
      const json = exportToProfile(
        existingProfile ?? null,
        characters,
        voiceMap,
        assignments,
        narratorVoice,
        bookName,
      );

      const writeJson = async (dir: FileSystemDirectoryHandle, name: string) => {
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
      };

      const bookFolder = await directoryHandle.getDirectoryHandle(bookName, { create: true });
      // Copy in the book folder and next to it, so the profile survives
      // if the user deletes the folder after listening.
      await writeJson(bookFolder, fileName);
      await writeJson(directoryHandle, fileName);
    });

    logger.info(`Saved voice mapping: ${bookName}/${fileName}`);
  } catch (err) {
    logger.warn('Could not save voice mapping', {
      error: getErrorMessage(err),
    });
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
  ports: ConversionPorts,
  signal: AbortSignal,
  input: OrchestratorInput,
  existingBook?: ProcessedBook | null,
): Promise<void> {
  const { logger, textBlockSplitter, llmStagesFactory, voicePoolBuilder } = services;

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
  // ChunkStore comes first: the check inspects/wipes the work folder through it.
  const chunkStore = services.chunkStoreFactory.create();
  const resumeInfo = await checkResumeState(chunkStore, directoryHandle, (msg) => logger.info(msg));

  let skipLLMSteps = false;
  let resumedAssignments: SpeakerAssignment[] | undefined;
  let resumedVoiceMap: Map<string, string> | undefined;
  let resumedCharacters: LLMCharacter[] | undefined;

  if (resumeInfo) {
    const confirmed = await ports.resume.confirm(resumeInfo);
    if (!confirmed) {
      ports.run.cancel();
      logger.info('User cancelled resume, starting fresh');
      if (await chunkStore.wipe(directoryHandle)) logger.info('Cleaned up _temp_work directory');
    } else if (resumeInfo.hasLLMState) {
      const pipelineState = await loadPipelineState(
        await chunkStore.peekWorkFolder(directoryHandle),
      );
      if (pipelineState) {
        skipLLMSteps = true;
        resumedAssignments = pipelineState.assignments;
        resumedVoiceMap = new Map(Object.entries(pipelineState.characterVoiceMap));
        resumedCharacters = pipelineState.characters;
        logger.info('Resuming with cached LLM state');
      }
    }
  } else {
    // Fresh start - clean any leftover _temp_work and IDB data
    if (await chunkStore.wipe(directoryHandle)) logger.info('Cleaned up _temp_work directory');
    await chunkStore.clearAll(directoryHandle);
  }

  // ==================== VOICE POOL VALIDATION ====================
  const pool = voicePoolBuilder.buildPool(input.detectedLanguage, input.enabledVoices);
  const totalVoices = pool.male.length + pool.female.length;
  if (totalVoices < 5 || pool.male.length < 2 || pool.female.length < 2) {
    throw insufficientVoicesError(pool.male.length, pool.female.length);
  }

  // ==================== INITIALIZATION ====================
  ports.run.begin();

  logger.info(`Detected language: ${input.detectedLanguage.toUpperCase()}`);

  const text = input.textContent;
  const fileNames =
    existingBook?.fileNames ?? ([[extractFilename(text), 0]] as Array<[string, number]>);

  // Progress reporter helper
  const report = (stage: StageId, current: number, total: number, message: string, failed = 0) => {
    logger.info(message);
    ports.progress.report(stage, current, total, message, failed);
  };

  try {
    // ==================== LLM STAGE 1: CHARACTER EXTRACTION ====================
    let characters: LLMCharacter[] | undefined;
    let voiceMap: Map<string, string> | undefined;

    if (!skipLLMSteps) {
      checkCancelled(signal);

      // Set initial LLM concurrency before starting LLM stage
      ports.progress.setConcurrency(input.llmThreads, 0);
      const setLlmConcurrency = (effective: number) => ports.progress.setConcurrency(effective, 0);

      // One stages record for the whole run (ADR 0015): per-stage configs in,
      // per-call signals out — the caller's signal is the only cancellation
      // channel, so there is no abort bridge here.
      const stages = llmStagesFactory.create({
        extract: input.extractConfig,
        assign: input.assignConfig,
        merge: input.mergeConfig,
        backup: { ...input.backupConfig },
        narratorVoice: input.narratorVoice,
        llmThreads: input.llmThreads,
        useVoting: input.useVoting,
        directoryHandle: input.directoryHandle,
        onConcurrencyChange: setLlmConcurrency,
        logger,
      });

      const blocks = textBlockSplitter.createExtractBlocks(text, input.detectedLanguage);
      report('character-extraction', 0, blocks.length, '=== LLM Pass 1: Character Extraction ===');

      characters = await stages.extract(blocks, {
        signal,
        onProgress: (current, total, message) => {
          report(
            'character-extraction',
            current,
            total,
            message ?? `Extract: Block ${current}/${total}`,
          );
        },
      });
      report(
        'character-extraction',
        blocks.length,
        blocks.length,
        `Detected ${characters.length} character(s)`,
      );

      // ==================== VOICE ASSIGNMENT (initial) ====================
      checkCancelled(signal);
      const initialAllocation = allocateByGender(characters, {
        narratorVoice: input.narratorVoice,
        pool,
      });
      voiceMap = initialAllocation.voiceMap;
      report(
        'voice-assignment',
        characters.length,
        characters.length,
        `Assigned ${initialAllocation.uniqueCount} voice(s) to ${characters.length} character(s)`,
      );

      // ==================== LLM STAGE 2: SPEAKER ASSIGNMENT ====================
      checkCancelled(signal);

      const assignBlocks = textBlockSplitter.createAssignBlocks(text, input.detectedLanguage);
      report(
        'speaker-assignment',
        0,
        assignBlocks.length,
        '=== LLM Pass 2: Speaker Assignment ===',
      );

      // Reassigned by the frequency remap below.
      let assignments: SpeakerAssignment[] = await stages.assign(
        assignBlocks,
        voiceMap,
        characters,
        {
          signal,
          onProgress: (current, total) => {
            report('speaker-assignment', current, total, `Assign: Block ${current}/${total}`);
          },
        },
      );
      report(
        'speaker-assignment',
        assignBlocks.length,
        assignBlocks.length,
        `Assigned speakers to ${assignments.length} sentence(s)`,
      );

      // Save pipeline state for resume
      const stateSaved = await savePipelineState(
        await chunkStore.ensureWorkFolder(directoryHandle).catch(() => null),
        {
          assignments,
          characterVoiceMap: Object.fromEntries(voiceMap),
          characters,
          fileNames,
        },
      );
      if (stateSaved) {
        report(
          'speaker-assignment',
          assignBlocks.length,
          assignBlocks.length,
          'Saved pipeline state for resume',
        );
      }

      // ==================== VOICE REMAPPING (by frequency) ====================
      checkCancelled(signal);

      // Count speaking frequency for tiered allocation
      const frequency = new Map<string, number>();
      for (const a of assignments) {
        if (a.speaker !== 'narrator') {
          frequency.set(a.speaker, (frequency.get(a.speaker) ?? 0) + 1);
        }
      }

      // Use tiered allocation for better voice distribution
      const frequencyAllocation = allocateTieredVoices({
        characters,
        frequency,
        pool,
        narratorVoice: input.narratorVoice,
      });
      voiceMap = frequencyAllocation.voiceMap;
      assignments = remapAssignments(assignments, voiceMap, input.narratorVoice);

      logVoiceSummary(
        characters,
        assignments,
        voiceMap,
        frequencyAllocation.rareVoices,
        frequencyAllocation.uniqueCount,
        pool,
        input.narratorVoice,
        logger,
      );

      // ==================== VOICE REVIEW PAUSE ====================
      checkCancelled(signal);

      const { voiceMap: reviewedVoiceMap, profile: existingProfile } = await ports.review.open(
        characters,
        voiceMap,
        assignments,
      );

      assignments = assignments.map((a) => ({
        ...a,
        voiceId:
          a.speaker === 'narrator'
            ? input.narratorVoice
            : (reviewedVoiceMap.get(a.speaker) ?? input.narratorVoice),
      }));

      checkCancelled(signal);

      // ==================== SAVE VOICE PROFILE ====================
      await saveVoiceProfile(
        directoryHandle,
        fileNames,
        characters,
        reviewedVoiceMap,
        assignments,
        input.narratorVoice,
        existingProfile,
        logger,
      );

      // ==================== TEXT SANITIZATION ====================
      checkCancelled(signal);
      assignments = sanitizeAssignments(assignments);
      report(
        'text-sanitization',
        assignments.length,
        assignments.length,
        'Text sanitization complete',
      );

      // ==================== DICTIONARY PROCESSING ====================
      checkCancelled(signal);
      assignments = applyDictionaryToAssignments(
        assignments,
        input.dictionaryRaw,
        input.lexxRegister,
      );
      report(
        'dictionary-processing',
        assignments.length,
        assignments.length,
        'Dictionary processing complete',
      );

      // Continue to TTS with assignments
      await runTTSStage(input, assignments, fileNames, signal, report, services, ports, chunkStore);
    } else {
      // ==================== RESUME MODE - SKIP LLM ====================
      characters = resumedCharacters!;
      voiceMap = resumedVoiceMap!;
      const assignments = resumedAssignments!;

      // voiceMap is already the reviewed map from pipeline_state.json
      ports.characters.push(characters, voiceMap, assignments);

      const remappedAssignments = assignments.map((a) => ({
        ...a,
        voiceId:
          a.speaker === 'narrator'
            ? input.narratorVoice
            : (voiceMap!.get(a.speaker) ?? input.narratorVoice),
      }));

      // Save voice profile (idempotent — safe to re-save on resume)
      await saveVoiceProfile(
        directoryHandle,
        fileNames,
        characters,
        voiceMap!,
        remappedAssignments,
        input.narratorVoice,
        null,
        logger,
      );

      const sanitized = sanitizeAssignments(remappedAssignments);
      const withDictionary = applyDictionaryToAssignments(
        sanitized,
        input.dictionaryRaw,
        input.lexxRegister,
      );

      await runTTSStage(
        input,
        withDictionary,
        fileNames,
        signal,
        report,
        services,
        ports,
        chunkStore,
      );
    }

    // ==================== COMPLETE ====================
    ports.run.complete();
    logger.info('Conversion complete!');
  } catch (error) {
    if (error instanceof AppError && error.isCancellation()) {
      ports.run.cancel();
      logger.info('Conversion cancelled');
    } else {
      const appError = AppError.fromUnknown(error);
      ports.run.fail(appError.message, appError.code);
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
  report: (
    stage: StageId,
    current: number,
    total: number,
    message: string,
    failed?: number,
  ) => void,
  services: ConversionOrchestratorServices,
  ports: ConversionPorts,
  chunkStore: ChunkStore,
): Promise<void> {
  const { logger, workerPoolFactory, audioMergerFactory, ffmpegService } = services;

  const directoryHandle = input.directoryHandle!;

  // ==================== INIT CHUNKSTORE ====================
  await chunkStore.init(directoryHandle);
  const failureLog = new FailureLog(chunkStore.workFolder(), logger);

  // ==================== TTS CONVERSION ====================
  checkCancelled(signal);

  const chunks = assignments
    .filter((a) => /[\p{L}\p{N}]/u.test(a.text))
    .map((a, index) => ({
      text: a.text,
      voice: a.voiceId,
      partIndex: index,
    }));

  if (chunks.length === 0) {
    throw new Error('No pronounceable content to convert');
  }

  report('tts-conversion', 0, chunks.length, `Converting ${chunks.length} chunks to audio...`, 0);

  const ttsConfig: TTSConfig = {
    voice: `Microsoft Server Speech Text to Speech Voice (${input.narratorVoice})`,
    pitch: input.pitch >= 0 ? `+${input.pitch}Hz` : `${input.pitch}Hz`,
    rate: input.rate >= 0 ? `+${input.rate}%` : `${input.rate}%`,
    volume: '+0%',
  };

  const audioMap = new Set<number>();
  const failedTasks = new Set<number>();

  // Pre-scan for cached chunks using ChunkStore. Indices at or beyond the
  // honest chunk count are stale residue from a previous Conversion — the
  // merge iterates chunks.length exactly, so they would only lie.
  let staleDropped = 0;
  const existingIndices = chunkStore.getExistingIndices();
  for (const index of existingIndices) {
    if (index >= chunks.length) {
      staleDropped++;
      continue;
    }
    audioMap.add(index);
  }

  if (audioMap.size > 0) {
    ports.progress.setPhaseBaseline(audioMap.size);
    report(
      'tts-conversion',
      audioMap.size,
      chunks.length,
      `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`,
      0,
    );
  }

  // Load previously failed chunks
  const previouslyFailed = await failureLog.load();
  let skippedCount = 0;
  for (const idx of previouslyFailed) {
    if (idx >= chunks.length) {
      staleDropped++;
      continue;
    }
    if (!audioMap.has(idx)) {
      audioMap.add(idx);
      skippedCount++;
    }
  }
  if (staleDropped > 0) {
    logger.debug?.(`Dropped ${staleDropped} stale chunk(s) from a previous run`);
  }
  if (skippedCount > 0) {
    report(
      'tts-conversion',
      audioMap.size,
      chunks.length,
      `Skipping ${skippedCount} previously failed chunk(s)`,
    );
  }

  const remainingChunks = chunks.filter((c) => !audioMap.has(c.partIndex));

  if (remainingChunks.length > 0) {
    const workerPool = workerPoolFactory.create({
      maxWorkers: input.ttsThreads,
      config: ttsConfig,
      chunkStore: chunkStore,
      logger: logger,
      onTaskComplete: (partIndex) => {
        audioMap.add(partIndex);
        const completed = audioMap.size;
        const percentageInterval = Math.max(1, Math.floor(chunks.length * 0.01));
        const minInterval = 50;
        const maxInterval = 500;
        const step = 50;
        const clampedInterval = Math.max(minInterval, Math.min(percentageInterval, maxInterval));
        const reportInterval = Math.round(clampedInterval / step) * step;
        const finalInterval = Math.max(minInterval, Math.min(reportInterval, maxInterval));

        if (completed % finalInterval === 0 || completed === chunks.length) {
          report(
            'tts-conversion',
            completed,
            chunks.length,
            `Written ${completed}/${chunks.length} files`,
            failedTasks.size,
          );
        }
      },
      onTaskError: (partIndex, error) => {
        failedTasks.add(partIndex);
        report(
          'tts-conversion',
          audioMap.size,
          chunks.length,
          `Part ${partIndex + 1} failed: ${getErrorMessage(error)}`,
          failedTasks.size,
        );
      },
      onRetry: (partIndex, _attempt, delayMs) => {
        report(
          'tts-conversion',
          audioMap.size,
          chunks.length,
          `Part ${partIndex + 1}: Retry in ${Math.round(delayMs / 1000)}s...`,
        );
      },
      onConcurrencyChange: (concurrency) => {
        ports.progress.setConcurrency(0, concurrency);
      },
    });

    const ttsTasks = remainingChunks.map((chunk) => ({
      partIndex: chunk.partIndex,
      text: chunk.text,
      voice: chunk.voice,
    }));

    // Settles on queue drain, or rejects with CancellationError when the
    // signal aborts (the pool tears itself down; the orchestrator catch
    // routes the rejection to ports.run.cancel).
    const outcome = await workerPool.run(ttsTasks, { signal });

    // Persist failed chunks
    if (outcome.failed.length > 0) {
      const totalFailed = await failureLog.record(outcome.failed);
      if (totalFailed !== null) {
        report(
          'tts-conversion',
          audioMap.size,
          chunks.length,
          `Persisted ${totalFailed} total failed chunk(s) to failed_chunks.json`,
        );
      }
    }
  }

  // ==================== AUDIO MERGE ====================
  checkCancelled(signal);

  if (audioMap.size === 0) {
    report('audio-merge', 1, 1, 'No audio to merge');
    await chunkStore.close();
    if (await chunkStore.wipe(directoryHandle)) {
      logger.debug?.('Cleaned up temp directory');
    } else {
      logger.debug?.('Cleanup skipped: _temp_work removal failed');
    }
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

  // Prepare ChunkStore for reading
  await chunkStore.prepareForRead();

  const merger = audioMergerFactory.create({
    audio: input.audio,
    outputFormat: 'opus',
    chunkStore: chunkStore,
  });

  const chunkCount = chunks.length;
  report('audio-merge', 0, chunkCount, 'Merging audio...');

  const savedCount = await merger.mergeAndSave(
    chunkCount,
    fileNames,
    directoryHandle,
    (current, total, message) => {
      report('audio-merge', current, total, message);
    },
  );

  report('audio-merge', chunkCount, chunkCount, `Saved ${savedCount} file(s)`);

  // ==================== CLEANUP ====================
  await chunkStore.close();
  if (await chunkStore.wipe(directoryHandle)) {
    logger.debug?.('Cleaned up temp directory');
  } else {
    logger.debug?.('Cleanup skipped: _temp_work removal failed');
  }
}
