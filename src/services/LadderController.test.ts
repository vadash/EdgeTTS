import { describe, it, expect, beforeEach } from 'vitest';
import { LadderController } from './LadderController';

describe('LadderController', () => {
  describe('initialization', () => {
    it('starts at minWorkers (2)', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      expect(ladder.getCurrentWorkers()).toBe(2);
    });

    it('respects maxWorkers ceiling', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 10);
      // Record 20 successful tasks
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBeLessThanOrEqual(10);
    });
  });

  describe('scaleUp', () => {
    it('increments by 1 when success rate exceeds threshold', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      // Record 19 successes, 1 failure (95% success)
      for (let i = 0; i < 19; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.recordTask(false, 1);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(3); // 2 -> 3
    });

    it('does not scale up until sampleSize reached', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      // Only 10 tasks
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(2); // unchanged
    });
  });

  describe('scaleDown', () => {
    it('reduces by 50% on immediate error call', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      // Manually scale to 8
      for (let i = 0; i < 120; i++) {  // Fixed: 60 -> 120 (2 + 120/20 = 8)
        ladder.recordTask(true, 0);
        ladder.evaluate();
      }
      expect(ladder.getCurrentWorkers()).toBe(8);
      // Now trigger scale down
      ladder.recordTask(false, 11);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(4); // 8 * 0.5
    });

    it('never goes below minWorkers (2)', () => {
      const ladder = new LadderController({ sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      // At 2 workers, scale down should stay at 2
      ladder.recordTask(false, 11);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(2);
    });
  });

  describe('history ring buffer', () => {
    it('keeps only sampleSize entries', () => {
      const ladder = new LadderController({ sampleSize: 5, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 }, 15);
      // Add 10 tasks
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      // Should scale up: 5 in history, 100% success > 90%, 2 -> 3
      expect(ladder.getCurrentWorkers()).toBe(3);
    });
  });
});
