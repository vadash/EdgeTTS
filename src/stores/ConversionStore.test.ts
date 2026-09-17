import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeLlmWorkers,
  activeTtsWorkers,
  cancel,
  complete,
  conversion,
  estimatedTimeRemaining,
  isProcessing,
  resetConversionStore,
  setConcurrencyStats,
  setError,
  setStatus,
  startConversion,
  updateProgress,
} from './ConversionStore';

describe('ConversionStore', () => {
  beforeEach(() => {
    resetConversionStore();
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

      vi.spyOn(Date, 'now').mockReturnValue(startTime + 60000);
      updateProgress(50, 50);

      const assignStartTime = startTime + 60000;
      vi.spyOn(Date, 'now').mockReturnValue(assignStartTime);
      setStatus('llm-assign');
      updateProgress(0, 100);

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

  describe('setStatus idempotence', () => {
    it('does not reset phaseStartTime when called with same status', () => {
      const startTime = 1000000;
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      startConversion();
      setStatus('converting');
      updateProgress(0, 100);

      const initialPhaseStartTime = conversion.value.phaseStartTime;
      expect(initialPhaseStartTime).toBe(startTime);

      vi.spyOn(Date, 'now').mockReturnValue(startTime + 5000);

      setStatus('converting');

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

      vi.spyOn(Date, 'now').mockReturnValue(startTime + 10000);
      setStatus('llm-assign');

      expect(conversion.value.phaseStartTime).toBe(startTime + 10000);
      expect(conversion.value.phaseStartTime).not.toBe(extractStartTime);

      vi.restoreAllMocks();
    });
  });

  describe('concurrency stats tracking', () => {
    it('sets LLM and TTS worker counts via setConcurrencyStats', () => {
      setConcurrencyStats(4, 8);
      expect(activeLlmWorkers.value).toBe(4);
      expect(activeTtsWorkers.value).toBe(8);
    });

    it('resets concurrency stats to zero', () => {
      setConcurrencyStats(4, 8);
      setConcurrencyStats(0, 0);
      expect(activeLlmWorkers.value).toBe(0);
      expect(activeTtsWorkers.value).toBe(0);
    });

    it('updates concurrency stats independently', () => {
      setConcurrencyStats(2, 4);
      expect(activeLlmWorkers.value).toBe(2);
      expect(activeTtsWorkers.value).toBe(4);

      setConcurrencyStats(6, 12);
      expect(activeLlmWorkers.value).toBe(6);
      expect(activeTtsWorkers.value).toBe(12);
    });
  });
});
