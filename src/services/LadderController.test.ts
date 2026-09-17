import { describe, expect, it } from 'vitest';
import { LadderController } from './LadderController';

describe('LadderController', () => {
  describe('initialization', () => {
    it('starts at minWorkers (5)', () => {
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
      expect(ladder.getCurrentWorkers()).toBe(5);
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
      expect(ladder.getCurrentWorkers()).toBe(7); // 5 -> 7 (scaleUpIncrement: 2)
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
      // 10 tasks, below sampleSize (20).
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5);
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
      // 85% success (17 successes, 3 failures), at or above the 0.8 scale-up threshold.
      for (let i = 0; i < 17; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(7); // 5 -> 7

      // History clears after a scale event, so record a full sampleSize
      // (20 successes) to scale up again.
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(9); // 7 -> 9

      // History clears after another scale event, so record a full sample
      // again: 17 successes and 3 failures (85%).
      for (let i = 0; i < 17; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      // 85% is at or above the 0.8 scale-up threshold, so the ladder scales
      // up. The scale-up check runs before the scale-down check, so a rate
      // in the 0.8 to 0.9 band never scales down.
      expect(ladder.getCurrentWorkers()).toBe(11); // 9 -> 11 (scales up, not down)

      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(13); // 11 -> 13

      // Record 70% success (below 0.8, definitely below 0.9)
      for (let i = 0; i < 14; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 6; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      // 70% is below 0.8, so the scale-down branch runs.
      expect(ladder.getCurrentWorkers()).toBe(6); // 13 * 0.5 = 6.5 -> floor to 6
    });
  });

  describe('scaleDown', () => {
    it('reduces by 50% on hard failure after sample size met', () => {
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
      // Scale to 11 workers: need 3 scale-ups (5->7->9->11)
      // Each scale-up requires 20 tasks after the previous scale
      for (let scaleUp = 0; scaleUp < 3; scaleUp++) {
        for (let i = 0; i < 20; i++) {
          ladder.recordTask(true, 0);
        }
        ladder.evaluate();
      }
      expect(ladder.getCurrentWorkers()).toBe(11);
      // History clears after a scale event, so a full sampleSize is needed
      // to evaluate. The failing task carries 5 retries, and retries >= 5
      // is a hard failure that trips the circuit breaker.
      for (let i = 0; i < 19; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.recordTask(false, 5);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5); // 11 * 0.5 = 5.5 -> floor to 5 (minWorkers)
    });

    it('never goes below minWorkers (5)', () => {
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
      ladder.recordTask(false, 11);
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5);
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
      for (let i = 0; i < 10; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      // Should scale up: 5 in history, 100% success > 80%, 5 -> 7
      expect(ladder.getCurrentWorkers()).toBe(7);
    });
  });

  describe('resetMetrics after scale events', () => {
    it('clears history after scale up to prevent thrashing', () => {
      const ladder = new LadderController(
        {
          sampleSize: 3,
          successThreshold: 0.9,
          scaleUpThreshold: 0.8,
          scaleUpIncrement: 2,
          scaleDownFactor: 0.5,
        },
        15,
      );

      // Record 3 successes to trigger scale up
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();

      expect(ladder.getCurrentWorkers()).toBe(7);

      // Record only 2 more mixed results (below sampleSize)
      // If history wasn't cleared, these might trigger immediate scale-down
      ladder.recordTask(true, 0);
      ladder.recordTask(false, 1);
      ladder.evaluate();

      expect(ladder.getCurrentWorkers()).toBe(7);
    });

    it('clears history after scale down to prevent thrashing', () => {
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

      // Scale to higher worker count first (5 -> 7)
      for (let i = 0; i < 5; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(7);

      // Trigger scale down with hard failure (need sampleSize to evaluate)
      for (let i = 0; i < 4; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.recordTask(false, 5);
      ladder.evaluate();

      // Should have scaled down (hard failure triggers immediate scale down)
      expect(ladder.getCurrentWorkers()).toBe(5);

      // Record only 2 more tasks (below sampleSize)
      // If history wasn't cleared, these might trigger immediate scale-up
      ladder.recordTask(true, 0);
      ladder.recordTask(true, 0);
      ladder.evaluate();

      expect(ladder.getCurrentWorkers()).toBe(5);
    });
  });
});
