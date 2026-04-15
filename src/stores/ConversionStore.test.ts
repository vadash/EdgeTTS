import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitResumeConfirmation,
  cancel,
  cancelResume,
  complete,
  confirmResume,
  conversion,
  elapsedTime,
  estimatedTimeRemaining,
  incrementProgress,
  isProcessing,
  progressPercent,
  resetConversionStore,
  setError,
  setFFmpegError,
  setFFmpegLoaded,
  setFFmpegLoading,
  setPhaseBaseline,
  setStatus,
  startConversion,
  updateProgress,
} from './ConversionStore';

describe('ConversionStore', () => {
  beforeEach(() => {
    resetConversionStore();
  });

  describe('initial state', () => {
    it('starts with idle status', () => {
      expect(conversion.value.status).toBe('idle');
    });
  });

  describe('isProcessing computed', () => {
    const processingCases = [
      { status: 'idle' as const, expected: false },
      { status: 'llm-extract' as const, expected: true },
      { status: 'llm-assign' as const, expected: true },
      { status: 'converting' as const, expected: true },
      { status: 'merging' as const, expected: true },
      { status: 'complete' as const, expected: false },
      { status: 'error' as const, expected: false },
      { status: 'cancelled' as const, expected: false },
    ];

    it.each(processingCases)('returns $expected for $status', ({ status, expected }) => {
      setStatus(status);
      expect(isProcessing.value).toBe(expected);
    });
  });

  describe('progress management', () => {
    it('updates progress', () => {
      updateProgress(5, 10);
      expect(conversion.value.progress).toEqual({ current: 5, total: 10, failed: 0 });
    });

    it('updates progress with failed count', () => {
      updateProgress(5, 10, 2);
      expect(conversion.value.progress).toEqual({ current: 5, total: 10, failed: 2 });
    });

    it('increments progress', () => {
      updateProgress(5, 10);
      incrementProgress();
      expect(conversion.value.progress).toEqual({ current: 6, total: 10, failed: 0 });
    });

    it('increments progress preserving failed count', () => {
      updateProgress(5, 10, 2);
      incrementProgress();
      expect(conversion.value.progress).toEqual({ current: 6, total: 10, failed: 2 });
    });

    describe('progressPercent computed', () => {
      it.each([
        [25, 100, 25],
        [0, 0, 0],
        [1, 3, 33],
      ])('calculates %d%% for current=%d, total=%d', (current, total, expected) => {
        updateProgress(current, total);
        expect(progressPercent.value).toBe(expected);
      });
    });
  });

  describe('startConversion', () => {
    it('resets progress to zero', () => {
      updateProgress(5, 10, 2);
      startConversion();
      expect(conversion.value.progress).toEqual({ current: 0, total: 0, failed: 0 });
    });
  });

  describe('error handling', () => {
    it('sets error with message', () => {
      setError('Something went wrong');
      expect(conversion.value.error?.message).toBe('Something went wrong');
      expect(conversion.value.status).toBe('error');
    });

    it('sets error with code', () => {
      setError('Network failure', 'NETWORK_ERROR');
      expect(conversion.value.error?.code).toBe('NETWORK_ERROR');
      expect(conversion.value.error?.message).toBe('Network failure');
    });

    it('records error timestamp', () => {
      const before = new Date();
      setError('Error');
      const after = new Date();

      expect(conversion.value.error?.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(conversion.value.error?.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('completion and cancellation', () => {
    it('marks as complete', () => {
      setStatus('converting');
      complete();
      expect(conversion.value.status).toBe('complete');
    });

    it('marks as cancelled', () => {
      setStatus('converting');
      cancel();
      expect(conversion.value.status).toBe('cancelled');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      setStatus('converting');
      updateProgress(5, 10, 2);
      setError('Error');
      startConversion();

      resetConversionStore();

      expect(conversion.value.status).toBe('idle');
      expect(conversion.value.progress).toEqual({ current: 0, total: 0, failed: 0 });
      expect(conversion.value.startTime).toBeNull();
      expect(conversion.value.phaseStartTime).toBeNull();
      expect(conversion.value.error).toBeNull();
    });
  });

  describe('FFmpeg state', () => {
    it('sets FFmpeg loaded', () => {
      setFFmpegLoading(true);
      setFFmpegLoaded(true);

      expect(conversion.value.ffmpegLoaded).toBe(true);
      expect(conversion.value.ffmpegLoading).toBe(false);
      expect(conversion.value.ffmpegError).toBeNull();
    });

    it('sets FFmpeg error', () => {
      setFFmpegLoading(true);
      setFFmpegError('Failed to load');

      expect(conversion.value.ffmpegError).toBe('Failed to load');
      expect(conversion.value.ffmpegLoading).toBe(false);
    });
  });

  describe('elapsed time formatting', () => {
    it('returns 00:00:00 when not started', () => {
      expect(elapsedTime.value).toBe('00:00:00');
    });

    it('formats elapsed time correctly', () => {
      // Mock Date.now to control time
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();

      // Advance time by 1 hour, 23 minutes, 45 seconds
      vi.spyOn(Date, 'now').mockReturnValue(startTime + (1 * 3600 + 23 * 60 + 45) * 1000);

      expect(elapsedTime.value).toBe('01:23:45');

      vi.restoreAllMocks();
    });
  });

  describe('estimated time remaining', () => {
    it('returns null when not started', () => {
      expect(estimatedTimeRemaining.value).toBeNull();
    });

    it('returns null when no progress', () => {
      startConversion();
      expect(estimatedTimeRemaining.value).toBeNull();
    });

    it('estimates time based on progress rate', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 100);

      // Advance time by 10 seconds, complete 10 items
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      updateProgress(10, 100);

      // 10 items in 10 seconds = 1 item/second
      // 90 items remaining = 90 seconds = 00:01:30
      expect(estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });

    it('calculates ETA for merging phase using phaseStartTime', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('merging');

      // Advance time by 30 seconds, complete 1 item
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 30000);
      updateProgress(1, 5);

      // 1 item in 30 seconds = 30s/item
      // 4 items remaining * 30s = 120s = 00:02:00
      expect(estimatedTimeRemaining.value).toBe('00:02:00');

      vi.restoreAllMocks();
    });

    it('resets phaseStartTime when transitioning between phases', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('llm-extract');
      updateProgress(0, 50);

      // Do some work in extract phase
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 60000); // 1 minute later
      updateProgress(50, 50);

      // Now transition to assign phase - phaseStartTime should reset
      const assignStartTime = startTime + 60000;
      vi.spyOn(Date, 'now').mockReturnValue(assignStartTime);
      setStatus('llm-assign');
      updateProgress(0, 100);

      // Advance 10 seconds into assign phase, complete 10 items
      vi.spyOn(Date, 'now').mockReturnValue(assignStartTime + 10000);
      updateProgress(10, 100);

      // ETA should be based on assign phase only (10s for 10 items = 1s/item)
      // 90 remaining * 1s = 90s = 00:01:30
      expect(estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });

    it('excludes failed chunks from remaining work estimate', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 100, 0);

      // Advance time by 10 seconds, complete 10 items with 5 failed
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      updateProgress(10, 100, 5);

      // 10 successful items in 10 seconds = 1s/item
      // Remaining items: 100 - 10 = 90
      // ETA: 90 * 1s = 90s = 00:01:30
      expect(estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });

    it('returns null for idle status', () => {
      updateProgress(10, 100);
      expect(estimatedTimeRemaining.value).toBeNull();
    });
  });

  describe('resume confirmation', () => {
    it('resolves promise when confirmed', async () => {
      const info = { cachedChunks: 5, hasLLMState: true };
      const promise = awaitResumeConfirmation(info);

      expect(conversion.value.resumeInfo).toEqual(info);

      confirmResume();
      await expect(promise).resolves.toBe(true);
      expect(conversion.value.resumeInfo).toBeNull();
    });

    it('resolves promise when cancelled', async () => {
      const info = { cachedChunks: 5, hasLLMState: true };
      const promise = awaitResumeConfirmation(info);

      cancelResume();
      await expect(promise).resolves.toBe(false);
      expect(conversion.value.resumeInfo).toBeNull();
    });
  });

  describe('setStatus idempotence', () => {
    it('does not reset phaseStartTime when called with same status', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 100);

      const initialPhaseStartTime = conversion.value.phaseStartTime;
      expect(initialPhaseStartTime).toBe(startTime);

      // Advance time
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 5000);

      // Call setStatus again with same status
      setStatus('converting');

      // phaseStartTime should NOT have been reset
      expect(conversion.value.phaseStartTime).toBe(initialPhaseStartTime);

      vi.restoreAllMocks();
    });

    it('initializes phaseStartProgress when entering processing status', () => {
      startConversion();
      updateProgress(10, 100);

      setStatus('converting');

      expect(conversion.value.phaseStartProgress).toBe(0);
    });

    it('resets phaseStartTime when transitioning to different status', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('llm-extract');

      const extractStartTime = conversion.value.phaseStartTime;
      expect(extractStartTime).toBe(startTime);

      // Advance time and transition to different status
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      setStatus('llm-assign');

      // phaseStartTime SHOULD be reset when status changes
      expect(conversion.value.phaseStartTime).toBe(startTime + 10000);
      expect(conversion.value.phaseStartTime).not.toBe(extractStartTime);

      vi.restoreAllMocks();
    });
  });

  describe('setPhaseBaseline', () => {
    it('sets phaseStartProgress to the given value', () => {
      startConversion();
      setStatus('converting');
      updateProgress(0, 100);

      setPhaseBaseline(100);

      expect(conversion.value.phaseStartProgress).toBe(100);
    });

    it('returns null ETA when current progress equals baseline (no items processed)', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 100);

      // Set baseline to 100 (e.g., 100 chunks already cached)
      setPhaseBaseline(100);

      // Advance time and update progress to match baseline
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      updateProgress(100, 100);

      // processed = current - baseline = 100 - 100 = 0
      // ETA should be null since no items have been processed
      expect(estimatedTimeRemaining.value).toBeNull();

      vi.restoreAllMocks();
    });

    it('calculates ETA correctly when progress exceeds baseline', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 200);

      // Set baseline to 100 (e.g., 100 chunks already cached)
      setPhaseBaseline(100);

      // Advance 10 seconds and process 10 more items (current = 110)
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      updateProgress(110, 200);

      // processed = 110 - 100 = 10 items in 10 seconds = 1s/item
      // remaining = 200 - 110 = 90 items
      // ETA = 90 * 1s = 90s = 00:01:30
      expect(estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });
  });
});
