import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversionStore, createConversionStore, resetConversionStore } from './ConversionStore';

describe('ConversionStore', () => {
  let store: ConversionStore;

  beforeEach(() => {
    resetConversionStore();
    store = createConversionStore();
  });

  describe('initial state', () => {
    it('starts with idle status', () => {
      expect(store.status.value).toBe('idle');
    });

    it('starts with zero progress', () => {
      expect(store.progress.value).toEqual({ current: 0, total: 0 });
    });

    it('starts with no error', () => {
      expect(store.error.value).toBeNull();
    });

    it('starts with FFmpeg not loaded', () => {
      expect(store.ffmpegLoaded.value).toBe(false);
      expect(store.ffmpegLoading.value).toBe(false);
      expect(store.ffmpegError.value).toBeNull();
    });
  });

  describe('isProcessing computed', () => {
    it('returns false for idle', () => {
      store.setStatus('idle');
      expect(store.isProcessing.value).toBe(false);
    });

    it('returns true for llm-extract', () => {
      store.setStatus('llm-extract');
      expect(store.isProcessing.value).toBe(true);
    });

    it('returns true for llm-assign', () => {
      store.setStatus('llm-assign');
      expect(store.isProcessing.value).toBe(true);
    });

    it('returns true for converting', () => {
      store.setStatus('converting');
      expect(store.isProcessing.value).toBe(true);
    });

    it('returns true for merging', () => {
      store.setStatus('merging');
      expect(store.isProcessing.value).toBe(true);
    });

    it('returns false for complete', () => {
      store.setStatus('complete');
      expect(store.isProcessing.value).toBe(false);
    });

    it('returns false for error', () => {
      store.setStatus('error');
      expect(store.isProcessing.value).toBe(false);
    });

    it('returns false for cancelled', () => {
      store.setStatus('cancelled');
      expect(store.isProcessing.value).toBe(false);
    });
  });

  describe('progress management', () => {
    it('updates progress', () => {
      store.updateProgress(5, 10);
      expect(store.progress.value).toEqual({ current: 5, total: 10 });
    });

    it('increments progress', () => {
      store.updateProgress(5, 10);
      store.incrementProgress();
      expect(store.progress.value).toEqual({ current: 6, total: 10 });
    });

    it('sets total count', () => {
      store.updateProgress(3, 5);
      store.setTotal(20);
      expect(store.progress.value).toEqual({ current: 3, total: 20 });
    });

    it('calculates progress percentage', () => {
      store.updateProgress(25, 100);
      expect(store.progressPercent.value).toBe(25);
    });

    it('returns 0 percent when total is 0', () => {
      store.updateProgress(0, 0);
      expect(store.progressPercent.value).toBe(0);
    });

    it('rounds progress percentage', () => {
      store.updateProgress(1, 3);
      expect(store.progressPercent.value).toBe(33);
    });
  });

  describe('startConversion', () => {
    it('sets start time', () => {
      const beforeStart = Date.now();
      store.startConversion();
      const afterStart = Date.now();

      expect(store.startTime.value).toBeGreaterThanOrEqual(beforeStart);
      expect(store.startTime.value).toBeLessThanOrEqual(afterStart);
    });

    it('resets progress to zero', () => {
      store.updateProgress(5, 10);
      store.startConversion();
      expect(store.progress.value).toEqual({ current: 0, total: 0 });
    });

    it('clears error', () => {
      store.setError('Previous error');
      store.startConversion();
      expect(store.error.value).toBeNull();
    });

    it('sets status to idle', () => {
      store.setStatus('converting');
      store.startConversion();
      expect(store.status.value).toBe('idle');
    });
  });

  describe('error handling', () => {
    it('sets error with message', () => {
      store.setError('Something went wrong');
      expect(store.error.value?.message).toBe('Something went wrong');
      expect(store.status.value).toBe('error');
    });

    it('sets error with code', () => {
      store.setError('Network failure', 'NETWORK_ERROR');
      expect(store.error.value?.code).toBe('NETWORK_ERROR');
      expect(store.error.value?.message).toBe('Network failure');
    });

    it('records error timestamp', () => {
      const before = new Date();
      store.setError('Error');
      const after = new Date();

      expect(store.error.value?.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(store.error.value?.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('completion and cancellation', () => {
    it('marks as complete', () => {
      store.setStatus('converting');
      store.complete();
      expect(store.status.value).toBe('complete');
    });

    it('marks as cancelled', () => {
      store.setStatus('converting');
      store.cancel();
      expect(store.status.value).toBe('cancelled');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      store.setStatus('converting');
      store.updateProgress(5, 10);
      store.setError('Error');
      store.startConversion();

      store.reset();

      expect(store.status.value).toBe('idle');
      expect(store.progress.value).toEqual({ current: 0, total: 0 });
      expect(store.startTime.value).toBeNull();
      expect(store.phaseStartTime.value).toBeNull();
      expect(store.error.value).toBeNull();
    });
  });

  describe('FFmpeg state', () => {
    it('sets FFmpeg loaded', () => {
      store.setFFmpegLoading(true);
      store.setFFmpegLoaded(true);

      expect(store.ffmpegLoaded.value).toBe(true);
      expect(store.ffmpegLoading.value).toBe(false);
      expect(store.ffmpegError.value).toBeNull();
    });

    it('sets FFmpeg loading', () => {
      store.setFFmpegLoading(true);
      expect(store.ffmpegLoading.value).toBe(true);
    });

    it('sets FFmpeg error', () => {
      store.setFFmpegLoading(true);
      store.setFFmpegError('Failed to load');

      expect(store.ffmpegError.value).toBe('Failed to load');
      expect(store.ffmpegLoading.value).toBe(false);
    });

    it('clears FFmpeg error', () => {
      store.setFFmpegError('Error');
      store.setFFmpegError(null);
      expect(store.ffmpegError.value).toBeNull();
    });
  });

  describe('elapsed time formatting', () => {
    it('returns 00:00:00 when not started', () => {
      expect(store.elapsedTime.value).toBe('00:00:00');
    });

    it('formats elapsed time correctly', () => {
      // Mock Date.now to control time
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      store.startConversion();

      // Advance time by 1 hour, 23 minutes, 45 seconds
      vi.spyOn(Date, 'now').mockReturnValue(startTime + (1 * 3600 + 23 * 60 + 45) * 1000);

      expect(store.elapsedTime.value).toBe('01:23:45');

      vi.restoreAllMocks();
    });
  });

  describe('estimated time remaining', () => {
    it('returns null when not started', () => {
      expect(store.estimatedTimeRemaining.value).toBeNull();
    });

    it('returns null when no progress', () => {
      store.startConversion();
      expect(store.estimatedTimeRemaining.value).toBeNull();
    });

    it('estimates time based on progress rate', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      store.startConversion();
      store.setStatus('converting'); // This sets phaseStartTime
      store.updateProgress(0, 100);

      // Advance time by 10 seconds, complete 10 items
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      store.updateProgress(10, 100);

      // 10 items in 10 seconds = 1 item/second
      // 90 items remaining = 90 seconds = 00:01:30
      expect(store.estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });

    it('calculates ETA for merging phase using phaseStartTime', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      store.startConversion();
      store.setStatus('merging'); // This sets phaseStartTime

      // Advance time by 30 seconds, complete 1 item
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 30000);
      store.updateProgress(1, 5);

      // 1 item in 30 seconds = 30s/item
      // 4 items remaining * 30s = 120s = 00:02:00
      expect(store.estimatedTimeRemaining.value).toBe('00:02:00');

      vi.restoreAllMocks();
    });

    it('resets phaseStartTime when transitioning between phases', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      store.startConversion();
      store.setStatus('llm-extract');
      store.updateProgress(0, 50);

      // Do some work in extract phase
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 60000); // 1 minute later
      store.updateProgress(50, 50);

      // Now transition to assign phase - phaseStartTime should reset
      const assignStartTime = startTime + 60000;
      vi.spyOn(Date, 'now').mockReturnValue(assignStartTime);
      store.setStatus('llm-assign');
      store.updateProgress(0, 100);

      // Advance 10 seconds into assign phase, complete 10 items
      vi.spyOn(Date, 'now').mockReturnValue(assignStartTime + 10000);
      store.updateProgress(10, 100);

      // ETA should be based on assign phase only (10s for 10 items = 1s/item)
      // 90 remaining * 1s = 90s = 00:01:30
      expect(store.estimatedTimeRemaining.value).toBe('00:01:30');

      vi.restoreAllMocks();
    });

    it('returns null for idle status', () => {
      store.updateProgress(10, 100);
      expect(store.estimatedTimeRemaining.value).toBeNull();
    });
  });
});
