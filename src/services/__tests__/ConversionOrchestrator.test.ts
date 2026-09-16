import { describe, expect, it, type Mock, vi } from 'vitest';
import { AppError } from '@/errors';
import type { ILogger } from '@/services/Logger';
import type { StageConfig, StageId } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import type { AudioMerger } from '../AudioMerger';
import type { ChunkStore } from '../ChunkStore';
import {
  type ConversionOrchestratorServices,
  type ConversionPorts,
  type OrchestratorInput,
  runConversion,
} from '../ConversionOrchestrator';
import type { FFmpegService } from '../FFmpegService';
import type { LLMVoiceService } from '../llm/LLMVoiceService';
import type { TextBlockSplitter } from '../TextBlockSplitter';
import type { TTSWorkerPool, WorkerPoolOptions } from '../TTSWorkerPool';

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
  const chunkStore = {
    init: vi.fn(() => Promise.resolve()),
    clearDatabase: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    getExistingIndices: vi.fn(() => new Set<number>()),
    prepareForRead: vi.fn(() => Promise.resolve()),
  };
  const workerPool = { addTasks: vi.fn(), clear: vi.fn() };
  const merger = { mergeAndSave: vi.fn(() => Promise.resolve(1)) };
  const llmService = {
    extractCharacters: vi.fn(() => Promise.resolve(TEST_CHARACTERS)),
    assignSpeakers: vi.fn(() => Promise.resolve(TEST_ASSIGNMENTS)),
    cancel: vi.fn(),
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
    llmServiceFactory: {
      create: vi.fn(() => llmService as unknown as LLMVoiceService),
    },
    workerPoolFactory: {
      create: vi.fn((opts: WorkerPoolOptions): TTSWorkerPool => {
        if (failPart !== undefined) {
          opts.onTaskError?.(failPart, new Error('tts boom'));
        }
        opts.onAllComplete?.();
        // Pool stand-in: the orchestrator only drives the callback surface
        return workerPool as unknown as TTSWorkerPool;
      }),
    },
    audioMergerFactory: {
      create: vi.fn(() => merger as unknown as AudioMerger),
    },
    voicePoolBuilder: {
      buildPool: vi.fn(() => ({ male: ['m1', 'm2'], female: ['f1', 'f2', 'f3'] })),
    },
    ffmpegService: { load: vi.fn(() => Promise.resolve(true)) } as unknown as FFmpegService,
    chunkStoreFactory: { create: () => chunkStore as unknown as ChunkStore },
  };
  return { services, chunkStore, workerPool, merger };
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
    expect(chunkStore.clearDatabase).toHaveBeenCalledTimes(1);
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
    const tasks = workerPool.addTasks.mock.calls[0][0];
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
    const tasks = workerPool.addTasks.mock.calls[0][0];
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
    expect(workerPool.addTasks).not.toHaveBeenCalled();
    // The only chunk was skipped, so the merge still runs over the cached audio
    expect(reportMessages(ports)).toContain('Saved 1 file(s)');
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
});
