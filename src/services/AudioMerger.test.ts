import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioMerger, type MergerConfig } from './AudioMerger';
import type { FFmpegService } from './FFmpegService';
import type { ChunkStore } from './ChunkStore';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';

// We need to test that mergeAudioGroupSync strips headers.
// Since mergeAudioGroupSync is private, we test via the public mergeAndSave path
// with MP3 format (which uses sync merge).
// Alternatively, test at integration level by checking output blob size.

/**
 * Mock FFmpegService for the parallel-merge tests. Each instance's
 * processAudio records that it started, awaits a controllable deferred
 * (so two instances can be observed encoding concurrently), then resolves
 * with non-empty bytes so mergeAudioGroupAsync yields a saved MergedFile.
 */
interface MockFFmpegService {
  label: 'primary' | 'worker';
  started: string[];
  release: () => void;
  processAudio: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

/**
 * Shared gate: resolves once two processAudio calls have begun. Each mock
 * calls gate.onStarted() synchronously on entry (before awaiting its
 * controllable deferred), so the test can wait deterministically for the
 * concurrency window without polling microtasks.
 */
interface StartGate {
  promise: Promise<void>;
  onStarted: () => void;
  count: number;
}

function createStartGate(): StartGate {
  let count = 0;
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    count,
    onStarted: () => {
      count++;
      if (count >= 2) resolveFn();
    },
  };
}

function createMockFFmpegService(label: 'primary' | 'worker', gate: StartGate): MockFFmpegService {
  const started: string[] = [];
  let resolveFn: (() => void) | null = null;
  const pendingPromise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return {
    label,
    started,
    release: () => resolveFn?.(),
    processAudio: vi
      .fn()
      .mockImplementation(
        async (
          _chunks: (Uint8Array | null)[],
          _config: unknown,
          _onProgress?: (m: string) => void,
        ) => {
          started.push(label);
          gate.onStarted();
          await pendingPromise;
          return new Uint8Array([0x4f, 0x70, 0x75, 0x73]); // 'Opus' — non-empty
        },
      ),
    terminate: vi.fn(),
  } as unknown as MockFFmpegService;
}

describe('AudioMerger - parallel merge pool', () => {
  let chunkStore: ChunkStore;

  beforeEach(() => {
    // Fake MP3 bytes — duration parsing is irrelevant: file boundaries
    // force 1-chunk-per-group, instead of MP3 frame duration extrapolation.
    const fakeChunk = new Uint8Array([0xff, 0xf2, 0xa4, 0xc0, 0x00, 0x00, 0x00, 0x00]);
    chunkStore = {
      init: vi.fn().mockResolvedValue(undefined),
      append: vi.fn(),
      prepareForRead: vi.fn().mockResolvedValue(undefined),
      readChunk: vi.fn().mockResolvedValue(fakeChunk),
      getExistingIndices: vi.fn().mockReturnValue(new Set<number>()),
      clearDatabase: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChunkStore;
  });

  it('runs groups concurrently across a 2-instance pool and terminates only the factory workers', async () => {
    const gate = createStartGate();
    const primaryMock = createMockFFmpegService('primary', gate);
    const workerMock = createMockFFmpegService('worker', gate);

    const config: MergerConfig = {
      outputFormat: 'opus',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      mergeConcurrency: 2,
      ffmpegFactory: () => workerMock as unknown as FFmpegService,
      chunkStore,
    };

    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, config);

    // File-boundary driven grouping: 'book1' for index 0, 'book2' for
    // indices 1..2. Both filenames share start index 1, so the first
    // boundary flips index 1 onward to 'book2' (index 0 stays 'book1').
    // Result: group [0,0]='book1', group [1,2]='book2' => 2 groups.
    const audioMap = new Map<number, string>([
      [0, 'chunk_0.mp3'],
      [1, 'chunk_1.mp3'],
      [2, 'chunk_2.mp3'],
    ]);
    const totalSentences = 3;
    const fileNames: Array<[string, number]> = [
      ['book1', 1],
      ['book2', 1],
    ];
    const saveDir = createMockDirectoryHandle();

    const progress: Array<[number, number, string]> = [];
    const onProgress = (current: number, total: number, message: string) => {
      progress.push([current, total, message]);
    };

    // Start mergeAndSave without awaiting — the pool workers block on their
    // controllable deferreds inside processAudio.
    const donePromise = merger.mergeAndSave(
      audioMap,
      totalSentences,
      fileNames,
      saveDir,
      onProgress,
    );

    // Wait deterministically until both pool workers have entered processAudio.
    await gate.promise;

    // ANCHOR CONTRACT: both pool workers entered processAudio before either
    // would have resolved — i.e. they were encoding concurrently.
    expect(primaryMock.processAudio).toHaveBeenCalledTimes(1);
    expect(workerMock.processAudio).toHaveBeenCalledTimes(1);

    // Release the deferreds so both groups complete and save.
    primaryMock.release();
    workerMock.release();

    const savedCount = await donePromise;

    // Both groups produced non-null output => exactly 2 saved.
    expect(savedCount).toBe(2);

    // The factory-produced worker is terminated after the merge; the
    // injected primary singleton is NOT (its lifecycle is owned upstream).
    expect(workerMock.terminate).toHaveBeenCalledTimes(1);
    expect(primaryMock.terminate).not.toHaveBeenCalled();

    // Progress reported processing for the group range.
    expect(progress.length).toBeGreaterThan(0);
  });

  it('degrades to concurrency 1 with the injected singleton when no ffmpegFactory is set', async () => {
    const gate = createStartGate();
    const primaryMock = createMockFFmpegService('primary', gate);

    const config: MergerConfig = {
      outputFormat: 'opus',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      mergeConcurrency: 2,
      chunkStore,
    };

    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, config);
    const audioMap = new Map<number, string>([
      [0, 'chunk_0.mp3'],
      [1, 'chunk_1.mp3'],
      [2, 'chunk_2.mp3'],
    ]);
    const totalSentences = 3;
    const fileNames: Array<[string, number]> = [
      ['book1', 1],
      ['book2', 1],
    ];

    primaryMock.release();
    const savedCount = await merger.mergeAndSave(
      audioMap,
      totalSentences,
      fileNames,
      createMockDirectoryHandle(),
    );

    // Only the injected singleton processed groups; no worker exists.
    expect(primaryMock.processAudio).toHaveBeenCalledTimes(2);
    expect(savedCount).toBe(2);
  });
});
