import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioMergeStep, createAudioMergeStep } from './AudioMergeStep';
import { createTestContext, createNeverAbortSignal, createTestAbortController, collectProgress, createContextWithAudio, createMockDirectoryHandle } from '@/test/pipeline/helpers';
import { createMockFFmpegService } from '@/test/mocks/MockFFmpegService';
import type { IAudioMerger, MergerConfig, IFFmpegService } from '@/services/interfaces';

describe('AudioMergeStep', () => {
  let step: AudioMergeStep;
  let mockFFmpegService: ReturnType<typeof createMockFFmpegService>;
  let mockAudioMerger: IAudioMerger;
  let capturedConfig: MergerConfig | undefined;

  // Disk-based audio map: index -> temp filename
  const testAudioMap = new Map<number, string>([
    [0, 'chunk_000000.bin'],
    [1, 'chunk_000001.bin'],
    [2, 'chunk_000002.bin'],
  ]);

  const createMockMerger = (savedCount: number): IAudioMerger => ({
    calculateMergeGroups: vi.fn(async () => [{ fromIndex: 0, toIndex: 2, filename: 'test', mergeNumber: 1, durationMs: 1000 }]),
    mergeAndSave: vi.fn(async () => savedCount),
  });

  beforeEach(() => {
    capturedConfig = undefined;
    mockFFmpegService = createMockFFmpegService();
    mockFFmpegService.load.mockResolvedValue(true);

    mockAudioMerger = createMockMerger(1);

    step = createAudioMergeStep({
      outputFormat: 'opus',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      ffmpegService: mockFFmpegService,
      createAudioMerger: (config) => {
        capturedConfig = config;
        return mockAudioMerger;
      },
    });
  });

  describe('name', () => {
    it('has correct step name', () => {
      expect(step.name).toBe('audio-merge');
    });
  });

  describe('execute', () => {
    it('merges audio chunks and saves to disk', async () => {
      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.savedFileCount).toBe(1);
    });

    it('calls audio merger with correct parameters', async () => {
      const directoryHandle = createMockDirectoryHandle();
      const context = createContextWithAudio(testAudioMap, {
        fileNames: [['chapter1', 0]],
        directoryHandle,
        assignments: [
          { sentenceIndex: 0, text: 'A', speaker: 'N', voiceId: 'v1' },
          { sentenceIndex: 1, text: 'B', speaker: 'N', voiceId: 'v1' },
          { sentenceIndex: 2, text: 'C', speaker: 'N', voiceId: 'v1' },
        ],
      });

      await step.execute(context, createNeverAbortSignal());

      expect(mockAudioMerger.mergeAndSave).toHaveBeenCalled();
      const [audioMap, totalChunks, fileNames, tempDirHandle, saveDirHandle] = (mockAudioMerger.mergeAndSave as any).mock.calls[0];
      expect(audioMap.size).toBe(3);
      expect(totalChunks).toBe(3);
      expect(fileNames).toEqual([['chapter1', 0]]);
      expect(tempDirHandle).toBeDefined();
      expect(saveDirHandle).toBe(directoryHandle);
    });

    it('preserves existing context properties', async () => {
      const context = createContextWithAudio(testAudioMap, {
        text: 'Original text.',
        directoryHandle: createMockDirectoryHandle(),
        characters: [{ code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] }],
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.characters).toHaveLength(1);
      expect(result.audioMap).toBe(testAudioMap);
    });

    it('throws when directoryHandle is missing', async () => {
      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: null,
      });

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow('Save directory handle required');
    });
  });

  describe('output format', () => {
    it('uses Opus format and loads FFmpeg', async () => {
      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(mockFFmpegService.load).toHaveBeenCalled();
      expect(capturedConfig?.outputFormat).toBe('opus');
    });

    it('throws when FFmpeg fails to load', async () => {
      mockFFmpegService.load.mockResolvedValue(false);

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow('FFmpeg failed to load');
    });
  });

  describe('audio processing options', () => {
    it('passes silence removal option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: true,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.silenceRemoval).toBe(true);
    });

    it('passes normalization option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: true,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.normalization).toBe(true);
    });

    it('passes eq option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: true,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.eq).toBe(true);
    });

    it('passes compressor option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: true,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.compressor).toBe(true);
    });

    it('passes fadeIn option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: true,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.fadeIn).toBe(true);
    });

    it('passes stereoWidth option', async () => {
      step = createAudioMergeStep({
        outputFormat: 'opus',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: true,
        ffmpegService: mockFFmpegService,
        createAudioMerger: (config) => {
          capturedConfig = config;
          return mockAudioMerger;
        },
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await step.execute(context, createNeverAbortSignal());

      expect(capturedConfig?.stereoWidth).toBe(true);
    });
  });

  describe('empty audio', () => {
    it('returns zero savedFileCount when no audio', async () => {
      const context = createContextWithAudio(new Map(), {
        directoryHandle: createMockDirectoryHandle(),
      });
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.savedFileCount).toBe(0);
    });

    it('returns zero savedFileCount when audioMap undefined', async () => {
      const context = {
        ...createTestContext(),
        directoryHandle: createMockDirectoryHandle(),
      };
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.savedFileCount).toBe(0);
    });
  });

  describe('progress reporting', () => {
    it('reports progress during merge', async () => {
      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
    });

    it('reports FFmpeg loading for Opus', async () => {
      step = createAudioMergeStep({
        outputFormat: 'opus',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: () => mockAudioMerger,
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      const { progress } = await collectProgress(step, context);

      expect(progress.some(p => p.message.toLowerCase().includes('ffmpeg'))).toBe(true);
    });

    it('reports saved file count', async () => {
      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      const { progress } = await collectProgress(step, context);

      const finalProgress = progress[progress.length - 1];
      expect(finalProgress.message).toContain('1');
      expect(finalProgress.message.toLowerCase()).toContain('saved');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });

    it('checks cancellation after FFmpeg loading', async () => {
      const controller = createTestAbortController();

      mockFFmpegService.load.mockImplementation(async () => {
        controller.abort();
        return true;
      });

      step = createAudioMergeStep({
        outputFormat: 'opus',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: () => mockAudioMerger,
      });

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: createMockDirectoryHandle(),
      });
      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });
  });

  describe('dropsContextKeys', () => {
    it('declares audioMap, tempDirHandle, and failedTasks as droppable', () => {
      expect(step.dropsContextKeys).toContain('audioMap');
      expect(step.dropsContextKeys).toContain('tempDirHandle');
      expect(step.dropsContextKeys).toContain('failedTasks');
    });
  });

  describe('resume - cached output files', () => {
    it('skips merge when output file already exists with size > 0', async () => {
      // Create a mock that checks for existing files
      const skipMockMerger: IAudioMerger = {
        calculateMergeGroups: vi.fn(async () => [{ fromIndex: 0, toIndex: 2, filename: 'Chapter 1', mergeNumber: 1, durationMs: 1000 }]),
        mergeAndSave: vi.fn(async (_audioMap, _totalSentences, fileNames, _tempDirHandle, saveDirectoryHandle, onProgress) => {
          const filename = 'Chapter 1.opus';
          const folderName = 'Chapter 1';
          try {
            const folderHandle = await saveDirectoryHandle.getDirectoryHandle(folderName);
            const fileHandle = await folderHandle.getFileHandle(filename);
            const file = await fileHandle.getFile();
            if (file.size > 1024) {
              onProgress?.(1, 1, `Skipping existing file: ${filename}`);
              return 0; // No files saved
            }
          } catch {
            // File doesn't exist, proceed with merge
          }
          onProgress?.(1, 1, `Saved ${filename}`);
          return 1; // 1 file saved
        }),
      };

      const skipStep = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: () => skipMockMerger,
      });

      // Pre-create an output file in the target directory
      const targetDir = createMockDirectoryHandle();
      const chapterFolder = await targetDir.getDirectoryHandle('Chapter 1', { create: true });
      const existingFile = await chapterFolder.getFileHandle('Chapter 1.opus', { create: true });
      const w = await existingFile.createWritable();
      await w.write(new Uint8Array(2000)); // > 1KB
      await w.close();

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: targetDir,
        fileNames: [['Chapter 1', 0]],
      });

      const result = await skipStep.execute(context, createNeverAbortSignal());
      expect(result.savedFileCount).toBe(0);
    });

    it('reports skipped files in progress message', async () => {
      const skipMockMerger: IAudioMerger = {
        calculateMergeGroups: vi.fn(async () => [{ fromIndex: 0, toIndex: 2, filename: 'Chapter 1', mergeNumber: 1, durationMs: 1000 }]),
        mergeAndSave: vi.fn(async (_audioMap, _totalSentences, _fileNames, _tempDirHandle, saveDirectoryHandle, onProgress) => {
          const filename = 'Chapter 1.opus';
          const folderName = 'Chapter 1';
          try {
            const folderHandle = await saveDirectoryHandle.getDirectoryHandle(folderName);
            const fileHandle = await folderHandle.getFileHandle(filename);
            const file = await fileHandle.getFile();
            if (file.size > 1024) {
              onProgress?.(1, 1, `Skipping existing file: ${filename}`);
              return 0;
            }
          } catch {
            // File doesn't exist
          }
          onProgress?.(1, 1, `Saved ${filename}`);
          return 1;
        }),
      };

      const skipStep = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: () => skipMockMerger,
      });

      const targetDir = createMockDirectoryHandle();
      const chapterFolder = await targetDir.getDirectoryHandle('Chapter 1', { create: true });
      const existingFile = await chapterFolder.getFileHandle('Chapter 1.opus', { create: true });
      const w = await existingFile.createWritable();
      await w.write(new Uint8Array(2000));
      await w.close();

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: targetDir,
        fileNames: [['Chapter 1', 0]],
      });

      const { progress } = await collectProgress(skipStep, context);
      expect(progress.some(p => p.message.toLowerCase().includes('skip') || p.message.toLowerCase().includes('existing'))).toBe(true);
    });

    it('does not skip when file size is too small (< 1KB)', async () => {
      const skipMockMerger: IAudioMerger = {
        calculateMergeGroups: vi.fn(async () => [{ fromIndex: 0, toIndex: 2, filename: 'Chapter 1', mergeNumber: 1, durationMs: 1000 }]),
        mergeAndSave: vi.fn(async (_audioMap, _totalSentences, fileNames, _tempDirHandle, saveDirectoryHandle, onProgress) => {
          const filename = 'Chapter 1.opus';
          const folderName = 'Chapter 1';
          try {
            const folderHandle = await saveDirectoryHandle.getDirectoryHandle(folderName);
            const fileHandle = await folderHandle.getFileHandle(filename);
            const file = await fileHandle.getFile();
            if (file.size > 1024) {
              onProgress?.(1, 1, `Skipping existing file: ${filename}`);
              return 0;
            }
          } catch {
            // File doesn't exist or too small
          }
          onProgress?.(1, 1, `Saved ${filename}`);
          return 1;
        }),
      };

      const skipStep = createAudioMergeStep({
        outputFormat: 'mp3',
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        ffmpegService: mockFFmpegService,
        createAudioMerger: () => skipMockMerger,
      });

      const targetDir = createMockDirectoryHandle();
      const chapterFolder = await targetDir.getDirectoryHandle('Chapter 1', { create: true });
      const existingFile = await chapterFolder.getFileHandle('Chapter 1.opus', { create: true });
      const w = await existingFile.createWritable();
      await w.write(new Uint8Array(500)); // < 1KB - likely partial/corrupt
      await w.close();

      const context = createContextWithAudio(testAudioMap, {
        directoryHandle: targetDir,
        fileNames: [['Chapter 1', 0]],
      });

      const result = await skipStep.execute(context, createNeverAbortSignal());
      // Should process normally (not skip)
      expect(result.savedFileCount).toBe(1);
    });
  });
});
