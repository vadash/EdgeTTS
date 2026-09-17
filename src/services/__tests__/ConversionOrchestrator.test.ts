import { describe, expect, it, type Mock, vi } from 'vitest';
import { AppError, CancellationError } from '@/errors';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, StageConfig, StageId } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { createMockChunkIdb } from '@/test/mocks/MockChunkIdb';
import type { AudioMerger, MergerConfig } from '../AudioMerger';
import { ChunkStore } from '../ChunkStore';
import {
  type ConversionOrchestratorServices,
  type ConversionPorts,
  type OrchestratorInput,
  runConversion,
} from '../ConversionOrchestrator';
import type { FFmpegService } from '../FFmpegService';
import type { LlmStages } from '../llm/stages';
import type { TextBlockSplitter } from '../TextBlockSplitter';
import type { PoolOutcome, PoolTask, TTSWorkerPool, WorkerPoolOptions } from '../TTSWorkerPool';

function mockStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
    apiKey: 'k',
    apiUrl: 'u',
    model: 'm',
    streaming: false,
    temperature: 0,
    topP: 1,
    reasoning: null,
    repeatPrompt: false,
    corsMiddleware: '',
    maxRetries: 3,
    ...overrides,
  };
}

function createMockInput(overrides?: Partial<OrchestratorInput>): OrchestratorInput {
  return {
    isLLMConfigured: true,
    directoryHandle: createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle,
    detectedLanguage: 'en',
    enabledVoices: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
    textContent: 'Hello world',
    dictionaryRaw: [],
    narratorVoice: 'narrator',
    pitch: 0,
    rate: 0,
    ttsThreads: 2,
    llmThreads: 1,
    useVoting: false,
    lexxRegister: false,
    outputFormat: 'opus' as const,
    audio: {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      opusMinBitrate: 24,
      opusMaxBitrate: 64,
      opusCompressionLevel: 10,
      mergeConcurrency: 2,
    },
    extractConfig: mockStageConfig(),
    mergeConfig: mockStageConfig(),
    assignConfig: mockStageConfig(),
    backupConfig: mockStageConfig(),
    ...overrides,
  };
}

type ReportFn = Mock<
  (stage: StageId, current: number, total: number, message: string, failed?: number) => void
>;

interface MockPorts extends ConversionPorts {
  progress: {
    report: ReportFn;
    setConcurrency: Mock;
    setPhaseBaseline: Mock;
  };
  review: { open: Mock };
  resume: { confirm: Mock };
  run: { begin: Mock; complete: Mock; cancel: Mock; fail: Mock };
  characters: { push: Mock };
}

function createMockPorts(): MockPorts {
  return {
    progress: {
      report: vi.fn(),
      setConcurrency: vi.fn(),
      setPhaseBaseline: vi.fn(),
    },
    review: {
      open: vi.fn(() => Promise.resolve({ voiceMap: new Map(), profile: null })),
    },
    resume: {
      confirm: vi.fn(() => Promise.resolve(true)),
    },
    run: {
      begin: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
      fail: vi.fn(),
    },
    characters: {
      push: vi.fn(),
    },
  };
}

const TEST_CHARACTERS = [
  { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' as const },
];
const TEST_ASSIGNMENTS = [
  { text: 'Hello', sentenceIndex: 0, speaker: 'Alice', voiceId: 'original' },
];

/**
 * Full-pipeline service mocks. failPart makes the worker pool report that
 * chunk as permanently failed. Class-typed members need unchecked casts
 * because their private state cannot be satisfied structurally.
 */
function createMockServices(failPart?: number) {
  // Real ChunkStore over the shared FS mock and an in-memory IDB adapter:
  // the orchestrator now drives resume/load/save through the store itself.
  const chunkIdb = createMockChunkIdb();
  const chunkStore = new ChunkStore(chunkIdb);
  vi.spyOn(chunkStore, 'init');
  vi.spyOn(chunkStore, 'clearAll');
  vi.spyOn(chunkStore, 'close');
  const workerPool = {
    run: vi.fn((_tasks: PoolTask[], _call: { signal: AbortSignal }) =>
      Promise.resolve<PoolOutcome>({ completed: new Set<number>(), failed: [] }),
    ),
  };
  const merger = {
    mergeAndSave: vi.fn((_chunkCount: number, _fileNames: Array<[string, number]>, _dir: unknown) =>
      Promise.resolve(1),
    ),
  };
  const mergerCreate = vi.fn((_config: MergerConfig) => merger as unknown as AudioMerger);
  // Loose record type so individual tests can swap stage implementations
  // (e.g. a hanging extract for the mid-flight abort regression).
  const llmStages: Record<string, Mock> = {
    extract: vi.fn(() => Promise.resolve(TEST_CHARACTERS)),
    assign: vi.fn(() => Promise.resolve(TEST_ASSIGNMENTS)),
    merge: vi.fn(async (characters: LLMCharacter[]) => characters),
    testConnection: vi.fn(async () => ({ success: true, model: 'mock-model' })),
  };
  const services: ConversionOrchestratorServices = {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } satisfies ILogger,
    textBlockSplitter: {
      createExtractBlocks: vi.fn(() => ['block1']),
      createAssignBlocks: vi.fn(() => ['block1']),
    } as unknown as TextBlockSplitter,
    llmStagesFactory: {
      create: vi.fn(() => llmStages as unknown as LlmStages),
    },
    workerPoolFactory: {
      create: vi.fn((opts: WorkerPoolOptions): TTSWorkerPool => {
        if (failPart !== undefined) {
          opts.onTaskError?.(failPart, new Error('tts boom'));
          workerPool.run.mockResolvedValue({
            completed: new Set<number>(),
            failed: [{ index: failPart, message: 'tts boom' }],
          });
        }
        // Pool stand-in: the orchestrator drives the callback surface and
        // awaits run() for the outcome
        return workerPool as unknown as TTSWorkerPool;
      }),
    },
    audioMergerFactory: { create: mergerCreate },
    voicePoolBuilder: {
      buildPool: vi.fn(() => ({ male: ['m1', 'm2'], female: ['f1', 'f2', 'f3'] })),
    },
    ffmpegService: { load: vi.fn(() => Promise.resolve(true)) } as unknown as FFmpegService,
    chunkStoreFactory: { create: () => chunkStore },
  };
  return { services, chunkStore, chunkIdb, workerPool, merger, mergerCreate, llmStages };
}

async function writeResumeState(
  dirHandle: FileSystemDirectoryHandle,
  extraFiles: Record<string, string> = {},
): Promise<void> {
  const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
  const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
  const writable = await stateFile.createWritable();
  await writable.write(
    JSON.stringify({
      assignments: TEST_ASSIGNMENTS,
      characterVoiceMap: { Alice: 'cached-alice' },
      characters: TEST_CHARACTERS,
      fileNames: [],
    }),
  );
  await writable.close();
  for (const [name, content] of Object.entries(extraFiles)) {
    const file = await tempDir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(content);
    await w.close();
  }
}

/** Progress report mock calls carry the message at index 3. */
function reportMessages(ports: MockPorts): string[] {
  return ports.progress.report.mock.calls.map((call) => call[3]);
}

describe('runConversion', () => {
  it('throws when text is empty', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    const input = createMockInput({ textContent: '' });
    await expect(
      runConversion(services, ports, new AbortController().signal, input),
    ).rejects.toThrow();
  });

  it('throws when LLM not configured', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    const input = createMockInput({ isLLMConfigured: false });
    await expect(
      runConversion(services, ports, new AbortController().signal, input),
    ).rejects.toThrow('LLM API key not configured');
  });

  it('throws when no directory handle', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    const input = createMockInput({ directoryHandle: null });
    await expect(
      runConversion(services, ports, new AbortController().signal, input),
    ).rejects.toThrow('Please select an output directory');
  });

  it('begins, clears the chunk DB, reviews, and completes a fresh conversion', async () => {
    const { services, chunkStore, workerPool } = createMockServices();
    const ports = createMockPorts();
    ports.review.open = vi.fn(() =>
      Promise.resolve({ voiceMap: new Map([['Alice', 'reviewed-alice']]), profile: null }),
    );

    await runConversion(services, ports, new AbortController().signal, createMockInput());

    expect(ports.run.begin).toHaveBeenCalledTimes(1);
    expect(chunkStore.clearAll).toHaveBeenCalledTimes(1);
    expect(chunkStore.init).toHaveBeenCalledTimes(1);
    expect(chunkStore.close).toHaveBeenCalledTimes(1);

    // Review gate replaces the direct store pushes on the fresh path
    expect(ports.review.open).toHaveBeenCalledTimes(1);
    expect(ports.review.open).toHaveBeenCalledWith(TEST_CHARACTERS, expect.any(Map), [
      {
        text: 'Hello',
        sentenceIndex: 0,
        speaker: 'Alice',
        voiceId: expect.any(String), // already remapped by tiered allocation
      },
    ]);
    expect(ports.characters.push).not.toHaveBeenCalled();

    // Reviewed voiceMap flows into the TTS chunk voices
    const tasks = workerPool.run.mock.calls[0][0];
    expect(tasks[0].voice).toBe('reviewed-alice');

    // LLM concurrency was announced before extraction
    expect(ports.progress.setConcurrency).toHaveBeenCalledWith(1, 0);

    // TTS progress is reported under the tts-conversion stage
    const ttsReported = ports.progress.report.mock.calls.some(
      (call) => call[0] === 'tts-conversion',
    );
    expect(ttsReported).toBe(true);

    expect(ports.run.complete).toHaveBeenCalledTimes(1);
    expect(ports.run.cancel).not.toHaveBeenCalled();
    expect(ports.run.fail).not.toHaveBeenCalled();
  });

  it('declining resume cancels the run and continues fresh', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    ports.resume.confirm = vi.fn(() => Promise.resolve(false));
    const dirHandle = createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
    await writeResumeState(dirHandle);

    await runConversion(
      services,
      ports,
      new AbortController().signal,
      createMockInput({ directoryHandle: dirHandle }),
    );

    expect(ports.resume.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ hasLLMState: true }),
    );
    expect(ports.run.cancel).toHaveBeenCalledTimes(1);
    // Fresh continuation ran to completion afterwards
    expect(ports.review.open).toHaveBeenCalledTimes(1);
    expect(ports.run.complete).toHaveBeenCalledTimes(1);
  });

  it('cancellation routes to ports.run.cancel instead of completing', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    const controller = new AbortController();
    controller.abort();

    await runConversion(services, ports, controller.signal, createMockInput());

    expect(ports.run.cancel).toHaveBeenCalledTimes(1);
    expect(ports.run.complete).not.toHaveBeenCalled();
  });

  it('mid-flight abort cancels the run and never records a failure', async () => {
    const { services, llmStages } = createMockServices();
    const ports = createMockPorts();
    const controller = new AbortController();
    // Extract hangs on the signal; aborting mid-run rejects with the one
    // canonical cancellation encoding (ADR 0017).
    llmStages.extract = vi.fn(
      (_blocks: unknown[], call: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(new CancellationError()), {
            once: true,
          });
        }),
    );

    const pending = runConversion(services, ports, controller.signal, createMockInput());
    await vi.waitFor(() => expect(llmStages.extract).toHaveBeenCalled());
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(ports.run.cancel).toHaveBeenCalledTimes(1);
    expect(ports.run.fail).not.toHaveBeenCalled();
    expect(ports.run.complete).not.toHaveBeenCalled();
  });

  it('mid-flight TTS pool abort cancels the run and records no failures', async () => {
    const { services, workerPool } = createMockServices();
    const ports = createMockPorts();
    const controller = new AbortController();
    // The pool hangs mid-run; aborting rejects with the one canonical
    // cancellation encoding (ADR 0017) once the pool protocol forwards it.
    workerPool.run = vi.fn(
      (_tasks: PoolTask[], call: { signal: AbortSignal }): Promise<PoolOutcome> =>
        new Promise<never>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(new CancellationError()), {
            once: true,
          });
        }),
    );

    const pending = runConversion(services, ports, controller.signal, createMockInput());
    await vi.waitFor(() => expect(workerPool.run).toHaveBeenCalled());
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(ports.run.cancel).toHaveBeenCalledTimes(1);
    expect(ports.run.fail).not.toHaveBeenCalled();
    expect(ports.run.complete).not.toHaveBeenCalled();
    // A cancelled run writes no progress: failureLog.record never ran
    expect(reportMessages(ports)).not.toContain(expect.stringContaining('Persisted'));
  });

  it('failures route through ports.run.fail with the app error code', async () => {
    const { services } = createMockServices();
    const ports = createMockPorts();
    services.textBlockSplitter.createExtractBlocks = vi.fn(() => {
      throw new AppError('LLM_API_ERROR', 'LLM exploded');
    });

    await expect(
      runConversion(services, ports, new AbortController().signal, createMockInput()),
    ).rejects.toThrow('LLM exploded');

    expect(ports.run.fail).toHaveBeenCalledWith('LLM exploded', 'LLM_API_ERROR');
    expect(ports.run.complete).not.toHaveBeenCalled();
  });

  it('resume mode pushes cached state and skips the review gate', async () => {
    const { services, workerPool } = createMockServices();
    const ports = createMockPorts();
    ports.resume.confirm = vi.fn(() => Promise.resolve(true));
    const dirHandle = createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
    await writeResumeState(dirHandle);

    await runConversion(
      services,
      ports,
      new AbortController().signal,
      createMockInput({ directoryHandle: dirHandle }),
    );

    expect(ports.characters.push).toHaveBeenCalledTimes(1);
    expect(ports.characters.push).toHaveBeenCalledWith(
      TEST_CHARACTERS,
      new Map([['Alice', 'cached-alice']]),
      TEST_ASSIGNMENTS,
    );
    expect(ports.review.open).not.toHaveBeenCalled();

    // Cached voiceMap flows into the TTS chunk voices
    const tasks = workerPool.run.mock.calls[0][0];
    expect(tasks[0].voice).toBe('cached-alice');
    expect(ports.run.complete).toHaveBeenCalledTimes(1);
  });

  it('skips previously failed chunks recorded in failed_chunks.json', async () => {
    const { services, workerPool } = createMockServices();
    const ports = createMockPorts();
    ports.resume.confirm = vi.fn(() => Promise.resolve(true));
    const dirHandle = createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
    await writeResumeState(dirHandle, { 'failed_chunks.json': '[0]' });

    await runConversion(
      services,
      ports,
      new AbortController().signal,
      createMockInput({ directoryHandle: dirHandle }),
    );

    expect(reportMessages(ports)).toContain('Skipping 1 previously failed chunk(s)');
    expect(workerPool.run).not.toHaveBeenCalled();
    // The only chunk was skipped, so the merge still runs over the cached audio
    expect(reportMessages(ports)).toContain('Saved 1 file(s)');
  });

  it('drops stale prescan indices beyond the honest chunk count', async () => {
    const { services, chunkIdb, merger } = createMockServices();
    const ports = createMockPorts();
    ports.resume.confirm = vi.fn(() => Promise.resolve(true));
    const dirHandle = createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
    await writeResumeState(dirHandle);

    // A previous Conversion left a chunk beyond the current Book: the honest
    // stream has exactly one pronounceable chunk (index 0), so index 999 is
    // stale store residue. Index 0 is a valid cached chunk.
    chunkIdb.store.set(0, new Uint8Array([0xff, 0xf2, 0xa4, 0xc0]));
    chunkIdb.store.set(999, new Uint8Array([0xff, 0xf2, 0xa4, 0xc0]));

    await runConversion(
      services,
      ports,
      new AbortController().signal,
      createMockInput({ directoryHandle: dirHandle }),
    );

    // The merge gets the honest count, not the store size.
    expect(merger.mergeAndSave).toHaveBeenCalledTimes(1);
    expect(merger.mergeAndSave.mock.calls[0][0]).toBe(1);
    // The stale index never inflates the resume baseline...
    expect(reportMessages(ports)).toContain('Resuming: found 1/1 cached chunks');
    // ...and its drop is logged.
    expect(services.logger.debug).toHaveBeenCalledWith(
      'Dropped 1 stale chunk(s) from a previous run',
    );
  });

  it('persists failed chunks via FailureLog and reports the total', async () => {
    const { services } = createMockServices(0);
    const ports = createMockPorts();

    await runConversion(services, ports, new AbortController().signal, createMockInput());

    expect(reportMessages(ports)).toContain('Part 1 failed: tts boom');
    expect(reportMessages(ports)).toContain(
      'Persisted 1 total failed chunk(s) to failed_chunks.json',
    );
    expect(ports.run.complete).toHaveBeenCalledTimes(1);
  });

  it('forwards the complete audio settings to the audio merger', async () => {
    const { services, mergerCreate } = createMockServices();
    const ports = createMockPorts();
    // Resume with one cached/failed chunk: the only path where the mock
    // pipeline has audio to merge, so audioMergerFactory.create runs.
    ports.resume.confirm = vi.fn(() => Promise.resolve(true));
    const dirHandle = createMockDirectoryHandle() as unknown as FileSystemDirectoryHandle;
    await writeResumeState(dirHandle, { 'failed_chunks.json': '[0]' });

    await runConversion(
      services,
      ports,
      new AbortController().signal,
      createMockInput({ directoryHandle: dirHandle }),
    );

    expect(reportMessages(ports)).toContain('Saved 1 file(s)');
    expect(mergerCreate).toHaveBeenCalledTimes(1);
    // Regression: the merger config was hand-copied field by field and
    // dropped opusMaxBitrate, so the merge silently fell back to the min
    // bitrate. The settings must travel as one object, untouched.
    expect(mergerCreate.mock.calls[0][0].audio).toEqual({
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      opusMinBitrate: 24,
      opusMaxBitrate: 64,
      opusCompressionLevel: 10,
      mergeConcurrency: 2,
    });
  });
});
