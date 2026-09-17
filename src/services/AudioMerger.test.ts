import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AudioMerger, filenameFor, type MergerConfig } from './AudioMerger';
import { ChunkStore } from './ChunkStore';
import type { FFmpegService } from './FFmpegService';
import { createMockChunkIdb } from '@/test/mocks/MockChunkIdb';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';

/**
 * Fake MP3 bytes — duration parsing is irrelevant: file boundaries
 * force 1-chunk-per-group in the boundary tests, instead of MP3 frame
 * duration extrapolation.
 */
const fakeChunk = new Uint8Array([0xff, 0xf2, 0xa4, 0xc0, 0x00, 0x00, 0x00, 0x00]);

/** Audio settings shared by every config below (all processing off). */
const AUDIO_SETTINGS = {
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
};

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
  processAudio: Mock;
  terminate: Mock;
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

describe('AudioMerger', () => {
  let chunkStore: ChunkStore;

  beforeEach(async () => {
    // Real ChunkStore over an in-memory IDB (ADR-0016). The merger asks
    // this store for availability; tests seed it like the TTS stage would.
    chunkStore = new ChunkStore(createMockChunkIdb());
    await chunkStore.init(createMockDirectoryHandle());
  });

  function makeConfig(overrides?: Partial<MergerConfig>): MergerConfig {
    return {
      outputFormat: 'opus',
      audio: AUDIO_SETTINGS,
      chunkStore,
      ...overrides,
    };
  }

  /** Seeds the store with the given indices, mirroring TTS-stage writes. */
  async function seedChunks(indices: number[]): Promise<void> {
    for (const i of indices) {
      await chunkStore.writeChunk(i, fakeChunk);
    }
    // Prod ordering: the orchestrator flushes the store before merging.
    await chunkStore.prepareForRead();
  }

  it('runs groups concurrently across a 2-instance pool and terminates only the factory workers', async () => {
    const gate = createStartGate();
    const primaryMock = createMockFFmpegService('primary', gate);
    const workerMock = createMockFFmpegService('worker', gate);
    const merger = new AudioMerger(
      primaryMock as unknown as FFmpegService,
      makeConfig({
        ffmpegFactory: () => workerMock as unknown as FFmpegService,
      }),
    );
    await seedChunks([0, 1, 2]);

    // File-boundary driven grouping: 'book1' for index 0, 'book2' for
    // indices 1..2. Both filenames share start index 1, so the first
    // boundary flips index 1 onward to 'book2' (index 0 stays 'book1').
    // Result: group [0,0]='book1', group [1,2]='book2' => 2 groups.
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
    const donePromise = merger.mergeAndSave(3, fileNames, saveDir, onProgress);

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
    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, makeConfig());
    await seedChunks([0, 1, 2]);

    const fileNames: Array<[string, number]> = [
      ['book1', 1],
      ['book2', 1],
    ];

    primaryMock.release();
    const savedCount = await merger.mergeAndSave(3, fileNames, createMockDirectoryHandle());

    // Only the injected singleton processed groups; no worker exists.
    expect(primaryMock.processAudio).toHaveBeenCalledTimes(2);
    expect(savedCount).toBe(2);
  });

  it('covers exactly chunkCount indices, turning store gaps into silence placeholders', async () => {
    const primaryMock = createMockFFmpegService('primary', createStartGate());
    primaryMock.release();
    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, makeConfig());
    // Sparse store: only 0 and 2 of 0..3 exist. No file boundaries, so all
    // of 0..3 lands in one group; the gaps must become silence placeholders.
    await seedChunks([0, 2]);

    const savedCount = await merger.mergeAndSave(4, [['book1', 4]], createMockDirectoryHandle());

    expect(savedCount).toBe(1);
    expect(primaryMock.processAudio).toHaveBeenCalledTimes(1);
    const [chunksArg] = primaryMock.processAudio.mock.calls[0] as [(Uint8Array | null)[]];
    expect(chunksArg).toEqual([fakeChunk, null, fakeChunk, null]);
  });

  it('iterates chunkCount, not the store size', async () => {
    const primaryMock = createMockFFmpegService('primary', createStartGate());
    primaryMock.release();
    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, makeConfig());
    // The store holds 3 chunks but the Book only has 2: the merge must cover
    // exactly 0..chunkCount-1 and never read past the honest count.
    await seedChunks([0, 1, 2]);

    const savedCount = await merger.mergeAndSave(2, [['book1', 2]], createMockDirectoryHandle());

    expect(savedCount).toBe(1);
    expect(primaryMock.processAudio).toHaveBeenCalledTimes(1);
    const [chunksArg] = primaryMock.processAudio.mock.calls[0] as [(Uint8Array | null)[]];
    expect(chunksArg).toEqual([fakeChunk, fakeChunk]);
  });

  it('saves each merged group at its composed folderName/fileName', async () => {
    const primaryMock = createMockFFmpegService('primary', createStartGate());
    primaryMock.release();
    const merger = new AudioMerger(primaryMock as unknown as FFmpegService, makeConfig());
    await seedChunks([0, 1, 2]);

    // 'My: Chapter' owns index 0, 'Beta' owns 1..2 (both boundaries at 1).
    // Two groups => padded part numbers on every saved file.
    const saveDir = createMockDirectoryHandle();
    const savedCount = await merger.mergeAndSave(
      3,
      [
        ['My: Chapter', 1],
        ['Beta', 1],
      ],
      saveDir,
    );

    expect(savedCount).toBe(2);

    // The saved path must be the composed folderName/fileName pair — no
    // regex round-trip over the filename. Both lookups throw if the file
    // landed anywhere else.
    const chapter = await saveDir.getDirectoryHandle('My_ Chapter');
    expect(await chapter.getFileHandle('My_ Chapter 0001.opus')).toBeTruthy();
    const beta = await saveDir.getDirectoryHandle('Beta');
    expect(await beta.getFileHandle('Beta 0001.opus')).toBeTruthy();
  });
});

describe('filenameFor', () => {
  const fileNames: Array<[string, number]> = [
    ['book1', 1],
    ['book2', 3],
  ];

  it('falls back to "audio" when the chapter table is empty', () => {
    expect(filenameFor([], 0)).toBe('audio');
    expect(filenameFor([], 7)).toBe('audio');
  });

  it('flips to the next chapter exactly at its boundary index', () => {
    expect(filenameFor(fileNames, 0)).toBe('book1');
    expect(filenameFor(fileNames, 2)).toBe('book1');
    expect(filenameFor(fileNames, 3)).toBe('book2');
  });

  it('never applies a boundary at index 0', () => {
    // The `boundaryIndex > 0` guard stops the walk at the zero entry.
    const zeroFirst: Array<[string, number]> = [
      ['x', 0],
      ['y', 2],
    ];
    expect(filenameFor(zeroFirst, 0)).toBe('x');
    expect(filenameFor(zeroFirst, 1)).toBe('x');
    expect(filenameFor(zeroFirst, 2)).toBe('x');
  });

  it('keeps the last chapter past the final boundary', () => {
    expect(filenameFor(fileNames, 99)).toBe('book2');
  });
});
