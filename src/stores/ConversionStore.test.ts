import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  conversion,
  isProcessing,
  progressPercent,
  elapsedTime,
  estimatedTimeRemaining,
  startConversion,
  setStatus,
  updateProgress,
  incrementProgress,
  setTotal,
  setError,
  complete,
  cancel,
  resetConversionStore,
  setFFmpegLoaded,
  setFFmpegLoading,
  setFFmpegError,
  awaitResumeConfirmation,
  confirmResume,
  cancelResume,
} from './ConversionStore';

describe('ConversionStore', () => {
  beforeEach(() => {
    resetConversionStore();
  });

  describe('initial state', () => {
    it('starts with idle status', () => {
      expect(conversion.value.status).toBe('idle');
    });

    it('starts with zero progress', () => {
      expect(conversion.value.progress).toEqual({ current: 0, total: 0 });
    });

    it('starts with no error', () => {
      expect(conversion.value.error).toBeNull();
    });

    it('starts with FFmpeg not loaded', () => {
      expect(conversion.value.ffmpegLoaded).toBe(false);
      expect(conversion.value.ffmpegLoading).toBe(false);
      expect(conversion.value.ffmpegError).toBeNull();
    });
  });

  describe('isProcessing computed', () => {
    it('returns false for idle', () => {
      setStatus('idle');
      expect(isProcessing.value).toBe(false);
    });

    it('returns true for llm-extract', () => {
      setStatus('llm-extract');
      expect(isProcessing.value).toBe(true);
    });

    it('returns true for llm-assign', () => {
      setStatus('llm-assign');
      expect(isProcessing.value).toBe(true);
    });

    it('returns true for converting', () => {
      setStatus('converting');
      expect(isProcessing.value).toBe(true);
    });

    it('returns true for merging', () => {
      setStatus('merging');
      expect(isProcessing.value).toBe(true);
    });

    it('returns false for complete', () => {
      setStatus('complete');
      expect(isProcessing.value).toBe(false);
    });

    it('returns false for error', () => {
      setStatus('error');
      expect(isProcessing.value).toBe(false);
    });

    it('returns false for cancelled', () => {
      setStatus('cancelled');
      expect(isProcessing.value).toBe(false);
    });
  });

  describe('progress management', () => {
    it('updates progress', () => {
      updateProgress(5, 10);
      expect(conversion.value.progress).toEqual({ current: 5, total: 10 });
    });

    it('increments progress', () => {
      updateProgress(5, 10);
      incrementProgress();
      expect(conversion.value.progress).toEqual({ current: 6, total: 10 });
    });

    it('sets total count', () => {
      updateProgress(3, 5);
      setTotal(20);
      expect(conversion.value.progress).toEqual({ current: 3, total: 20 });
    });

    it('calculates progress percentage', () => {
      updateProgress(25, 100);
      expect(progressPercent.value).toBe(25);
    });

    it('returns 0 percent when total is 0', () => {
      updateProgress(0, 0);
      expect(progressPercent.value).toBe(0);
    });

    it('rounds progress percentage', () => {
      updateProgress(1, 3);
      expect(progressPercent.value).toBe(33);
    });
  });

  describe('startConversion', () => {
    it('sets start time', () => {
      const beforeStart = Date.now();
      startConversion();
      const afterStart = Date.now();

      expect(conversion.value.startTime).toBeGreaterThanOrEqual(beforeStart);
      expect(conversion.value.startTime).toBeLessThanOrEqual(afterStart);
    });

    it('resets progress to zero', () => {
      updateProgress(5, 10);
      startConversion();
      expect(conversion.value.progress).toEqual({ current: 0, total: 0 });
    });

    it('clears error', () => {
      setError('Previous error');
      startConversion();
      expect(conversion.value.error).toBeNull();
    });

    it('sets status to idle', () => {
      setStatus('converting');
      startConversion();
      expect(conversion.value.status).toBe('idle');
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
      updateProgress(5, 10);
      setError('Error');
      startConversion();

      resetConversionStore();

      expect(conversion.value.status).toBe('idle');
      expect(conversion.value.progress).toEqual({ current: 0, total: 0 });
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

    it('sets FFmpeg loading', () => {
      setFFmpegLoading(true);
      expect(conversion.value.ffmpegLoading).toBe(true);
    });

    it('sets FFmpeg error', () => {
      setFFmpegLoading(true);
      setFFmpegError('Failed to load');

      expect(conversion.value.ffmpegError).toBe('Failed to load');
      expect(conversion.value.ffmpegLoading).toBe(false);
    });

    it('clears FFmpeg error', () => {
      setFFmpegError('Error');
      setFFmpegError(null);
      expect(conversion.value.ffmpegError).toBeNull();
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

    it('returns null for idle status', () => {
      updateProgress(10, 100);
      expect(estimatedTimeRemaining.value).toBeNull();
    });
  });

  describe('resume confirmation', () => {
    it('sets resume info and resolves promise when confirmed', async () => {
      const info = { cachedChunks: 5, hasLLMState: true };
      const promise = awaitResumeConfirmation(info);

      expect(conversion.value.resumeInfo).toEqual(info);

      confirmResume();
      await expect(promise).resolves.toBe(true);
      expect(conversion.value.resumeInfo).toBeNull();
    });

    it('sets resume info and resolves promise when cancelled', async () => {
      const info = { cachedChunks: 5, hasLLMState: true };
      const promise = awaitResumeConfirmation(info);

      cancelResume();
      await expect(promise).resolves.toBe(false);
      expect(conversion.value.resumeInfo).toBeNull();
    });
  });
});
