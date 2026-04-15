import { describe, expect, it } from 'vitest';
import { LadderController } from './LadderController';

describe('LadderController', () => {
  describe('initialization', () => {
    it('starts at minWorkers (3)', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      expect(ladder.getCurrentWorkers()).toBe(3);
    });

    it('respects maxWorkers ceiling', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        10,
      );
      // Record 20 successful tasks
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBeLessThanOrEqual(10);
    });
  });

  describe('scaleUp', () => {
    it('increments by scaleUpIncrement when success rate exceeds scaleUpThreshold', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // Record 17 successes, 3 failures (85% success, which is >= 0.8 scaleUpThreshold)
      for (let i = 0; i < 17; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5); // 3 -> 5 (scaleUpIncrement: 2)
    });

    it('does not scale up until sampleSize reached', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // Only 10 tasks
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(3); // unchanged
    });

    it('uses hysteresis: scales up at 0.8 but scales down at 0.9', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // 85% success (17 successes, 3 failures) - should scale up (>= 0.8)
      for (let i = 0; i < 17; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5); // 3 -> 5

      // Reset history
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBeGreaterThanOrEqual(5);

      // 89% success (below 0.9, should scale down)
      ladder.recordTask(false, 11);
      ladder.evaluate();
      // Should scale down since successRate < 0.9
      expect(ladder.getCurrentWorkers()).toBeLessThan(7);
    });
  });

  describe('scaleDown', () => {
    it('reduces by 50% on immediate error call', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // Manually scale to 9
      for (let i = 0; i < 60; i++) {
        // 3 + (60/20)*2 = 9
        ladder.recordTask(true, 0);
        ladder.evaluate();
      }
      expect(ladder.getCurrentWorkers()).toBe(9);
      // Now trigger scale down
      ladder.recordTask(false, 11);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(4); // 9 * 0.5 = 4.5 -> floor to 4
    });

    it('never goes below minWorkers (3)', () => {
      const ladder = new LadderController(
        {
          sampleSize: 20,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // At 3 workers, scale down should stay at 3
      ladder.recordTask(false, 11);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(3);
    });
  });

  describe('history ring buffer', () => {
    it('keeps only sampleSize entries', () => {
      const ladder = new LadderController(
        {
          sampleSize: 5,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );
      // Add 10 tasks
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      // Should scale up: 5 in history, 100% success > 80%, 3 -> 5
      expect(ladder.getCurrentWorkers()).toBe(5);
    });
  });
});
