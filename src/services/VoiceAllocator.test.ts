import { describe, expect, it } from 'vitest';
import type { VoicePool } from '@/state/types';
import { VoicePoolTracker } from './VoiceAllocator';

describe('VoicePoolTracker', () => {
  const pool: VoicePool = {
    male: ['en-US, AndrewNeural', 'en-US, BrianNeural', 'en-US, AndrewMultilingualNeural'],
    female: ['en-US, AvaNeural', 'en-US, JennyNeural'],
  };

  describe('pickVoice', () => {
    it('picks voices sequentially from pool (first available, not random)', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      // Should always pick first available = AndrewNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, AndrewNeural');

      // Second pick should be BrianNeural (AndrewNeural now used)
      const second = tracker.pickVoice('male');
      expect(second).toBe('en-US, BrianNeural');

      // Third pick should be AndrewMultilingualNeural
      const third = tracker.pickVoice('male');
      expect(third).toBe('en-US, AndrewMultilingualNeural');
    });

    it('respects reserved voices when picking sequentially', () => {
      const reserved = new Set(['en-US, AndrewNeural']);
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural', reserved);

      // AndrewNeural is reserved, should skip to BrianNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, BrianNeural');
    });

    it('cycles through pool when exhausted', () => {
      const tracker = new VoicePoolTracker(pool, 'en-US, NarratorNeural');

      // Exhaust female pool
      tracker.pickVoice('female'); // AvaNeural
      tracker.pickVoice('female'); // JennyNeural

      // Pool exhausted — should cycle from beginning
      const reused = tracker.pickVoice('female');
      expect(pool.female).toContain(reused);
    });

    it('narrator voice is always reserved', () => {
      const smallPool: VoicePool = {
        male: ['en-US, NarratorNeural', 'en-US, BrianNeural'],
        female: [],
      };
      const tracker = new VoicePoolTracker(smallPool, 'en-US, NarratorNeural');

      // Should skip narrator, pick BrianNeural
      const first = tracker.pickVoice('male');
      expect(first).toBe('en-US, BrianNeural');
    });
  });
});
