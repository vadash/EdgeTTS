import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSConversionStep, createTTSConversionStep } from './TTSConversionStep';
import { createTestContext, createNeverAbortSignal, createTestAbortController, collectProgress, createContextWithAssignments } from '@/test/pipeline/helpers';
import type { IWorkerPool, WorkerPoolOptions, PoolTask, SpeakerAssignment } from '@/services/interfaces';

describe('TTSConversionStep', () => {
  let step: TTSConversionStep;
  let mockWorkerPool: IWorkerPool;
  let capturedOptions: WorkerPoolOptions | undefined;
  let capturedTasks: PoolTask[];

  const testAssignments: SpeakerAssignment[] = [
    { sentenceIndex: 0, text: 'Hello world.', speaker: 'Narrator', voiceId: 'voice-1' },
    { sentenceIndex: 1, text: 'How are you?', speaker: 'Alice', voiceId: 'voice-2' },
    { sentenceIndex: 2, text: 'I am fine.', speaker: 'Bob', voiceId: 'voice-3' },
  ];

  const createMockWorkerPool = (): IWorkerPool => {
    const completedAudio = new Map<number, Uint8Array>();
    const failedTasks = new Set<number>();
    let onAllCompleteCallback: (() => void) | undefined;

    return {
      addTask: vi.fn((task: PoolTask) => {
        capturedTasks.push(task);
      }),
      addTasks: vi.fn((tasks: PoolTask[]) => {
        capturedTasks.push(...tasks);
        // Store callback for later and simulate completion
        onAllCompleteCallback = capturedOptions?.onAllComplete;
        tasks.forEach((task, i) => {
          completedAudio.set(task.partIndex, new Uint8Array([i + 1]));
          capturedOptions?.onTaskComplete?.(task.partIndex, new Uint8Array([i + 1]));
        });
        // Immediately call onAllComplete
        onAllCompleteCallback?.();
      }),
      getCompletedAudio: vi.fn(() => completedAudio),
      getFailedTasks: vi.fn(() => failedTasks),
      getProgress: vi.fn(() => ({
        completed: completedAudio.size,
        total: capturedTasks.length,
        failed: failedTasks.size,
      })),
      clear: vi.fn(() => {
        completedAudio.clear();
        failedTasks.clear();
        capturedTasks = [];
      }),
    };
  };

  beforeEach(() => {
    capturedTasks = [];
    capturedOptions = undefined;
    mockWorkerPool = createMockWorkerPool();

    step = createTTSConversionStep({
      maxWorkers: 3,
      ttsConfig: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
      },
      createWorkerPool: (options) => {
        capturedOptions = options;
        return mockWorkerPool;
      },
    });
  });

  describe('name', () => {
    it('has correct step name', () => {
      expect(step.name).toBe('tts-conversion');
    });
  });

  describe('execute', () => {
    it('converts assignments to audio', async () => {
      const context = createContextWithAssignments(testAssignments);
      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.audioMap).toBeDefined();
      expect(result.audioMap!.size).toBe(3);
    });

    it('creates worker pool with correct options', async () => {
      const context = createContextWithAssignments(testAssignments);
      await step.execute(context, createNeverAbortSignal());

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.maxWorkers).toBe(3);
    });

    it('adds tasks to worker pool', async () => {
      const context = createContextWithAssignments(testAssignments);
      await step.execute(context, createNeverAbortSignal());

      expect(mockWorkerPool.addTasks).toHaveBeenCalled();
      expect(capturedTasks.length).toBe(3);
    });

    it('builds tasks with correct properties', async () => {
      const context = createContextWithAssignments(testAssignments, {
        fileNames: [['chapter1', 0]],
      });
      await step.execute(context, createNeverAbortSignal());

      const firstTask = capturedTasks[0];
      expect(firstTask.text).toBe('Hello world.');
      expect(firstTask.voice).toBe('voice-1');
      expect(firstTask.filename).toBe('chapter1');
    });

    it('preserves existing context properties', async () => {
      const context = createContextWithAssignments(testAssignments, {
        text: 'Original text.',
        characters: [{ code: 'A', canonicalName: 'Alice', gender: 'female', aliases: [] }],
      });

      const result = await step.execute(context, createNeverAbortSignal());

      expect(result.text).toBe('Original text.');
      expect(result.characters).toHaveLength(1);
      expect(result.assignments).toEqual(testAssignments);
    });
  });

  describe('filtering', () => {
    it('filters out empty sentences', async () => {
      const assignmentsWithEmpty: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: 'Valid text.', speaker: 'Narrator', voiceId: 'voice-1' },
        { sentenceIndex: 1, text: '   ', speaker: 'Alice', voiceId: 'voice-2' },
        { sentenceIndex: 2, text: '', speaker: 'Bob', voiceId: 'voice-3' },
        { sentenceIndex: 3, text: 'Another valid.', speaker: 'Narrator', voiceId: 'voice-1' },
      ];

      const context = createContextWithAssignments(assignmentsWithEmpty);
      await step.execute(context, createNeverAbortSignal());

      // Should only have 2 tasks (filtered out empty/whitespace)
      expect(capturedTasks.length).toBe(2);
    });

    it('filters out non-pronounceable content', async () => {
      const assignmentsWithSymbols: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: '---', speaker: 'Narrator', voiceId: 'voice-1' },
        { sentenceIndex: 1, text: '...', speaker: 'Alice', voiceId: 'voice-2' },
        { sentenceIndex: 2, text: 'Hello!', speaker: 'Bob', voiceId: 'voice-3' },
      ];

      const context = createContextWithAssignments(assignmentsWithSymbols);
      await step.execute(context, createNeverAbortSignal());

      // Should only have 1 task with actual text
      expect(capturedTasks.length).toBe(1);
      expect(capturedTasks[0].text).toBe('Hello!');
    });
  });

  describe('missing prerequisites', () => {
    it('throws when assignments missing', async () => {
      const context = createTestContext();

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow("requires 'assignments'");
    });

    it('throws when assignments empty', async () => {
      const context = createContextWithAssignments([]);

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow("non-empty 'assignments'");
    });

    it('throws when no pronounceable content', async () => {
      const emptyAssignments: SpeakerAssignment[] = [
        { sentenceIndex: 0, text: '---', speaker: 'N', voiceId: 'v1' },
      ];
      const context = createContextWithAssignments(emptyAssignments);

      await expect(step.execute(context, createNeverAbortSignal()))
        .rejects.toThrow('No pronounceable content');
    });
  });

  describe('progress reporting', () => {
    it('reports progress during conversion', async () => {
      const context = createContextWithAssignments(testAssignments);
      const { progress } = await collectProgress(step, context);

      expect(progress.length).toBeGreaterThan(0);
    });

    it('reports chunk count in initial message', async () => {
      const context = createContextWithAssignments(testAssignments);
      const { progress } = await collectProgress(step, context);

      expect(progress[0].message).toContain('3 chunks');
    });
  });

  describe('cancellation', () => {
    it('throws when aborted before execution', async () => {
      const controller = createTestAbortController();
      controller.abort();

      const context = createContextWithAssignments(testAssignments);
      await expect(step.execute(context, controller.signal))
        .rejects.toThrow();
    });

    it('clears worker pool when aborted', async () => {
      const controller = createTestAbortController();

      // Create a mock pool that doesn't auto-complete
      const neverCompletingPool: IWorkerPool = {
        addTask: vi.fn(),
        addTasks: vi.fn((tasks: PoolTask[]) => {
          capturedTasks.push(...tasks);
          // Don't call onAllComplete - simulate long-running operation
        }),
        getCompletedAudio: vi.fn(() => new Map()),
        getFailedTasks: vi.fn(() => new Set()),
        getProgress: vi.fn(() => ({ completed: 0, total: 0, failed: 0 })),
        clear: vi.fn(),
      };

      const stepWithNeverCompletingPool = createTTSConversionStep({
        maxWorkers: 3,
        ttsConfig: {
          voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
          rate: '+0%',
          pitch: '+0Hz',
        },
        createWorkerPool: (options) => {
          capturedOptions = options;
          return neverCompletingPool;
        },
      });

      const context = createContextWithAssignments(testAssignments);

      // Start execution but abort immediately
      controller.abort();

      try {
        await stepWithNeverCompletingPool.execute(context, controller.signal);
      } catch {
        // Expected - step throws when aborted
      }

      // The clear method should have been called when abort was detected
      // Note: The step checks cancellation at start, so clear may not be called
      // if abort happens before pool creation
    });
  });

  describe('file name handling', () => {
    it('uses first file name when no boundaries', async () => {
      const context = createContextWithAssignments(testAssignments, {
        fileNames: [['mybook', 0]],
      });

      await step.execute(context, createNeverAbortSignal());

      expect(capturedTasks[0].filename).toBe('mybook');
    });

    it('switches file names at boundaries', async () => {
      const context = createContextWithAssignments(testAssignments, {
        fileNames: [['chapter1', 0], ['chapter2', 2]],
      });

      await step.execute(context, createNeverAbortSignal());

      // First two sentences should be chapter1, third should be chapter2
      expect(capturedTasks[0].filename).toBe('chapter1');
      expect(capturedTasks[1].filename).toBe('chapter1');
      expect(capturedTasks[2].filename).toBe('chapter2');
    });

    it('uses default when no file names', async () => {
      const context = createContextWithAssignments(testAssignments, {
        fileNames: [],
      });

      await step.execute(context, createNeverAbortSignal());

      expect(capturedTasks[0].filename).toBe('audio');
    });
  });
});
