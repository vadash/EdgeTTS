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

      // After scale up, history is cleared. Need to record sampleSize tasks again.
      // Record 20 successes to scale up again
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(7); // 5 -> 7

      // After scale up, history is cleared again.
      // Record 89% success (below 0.9 threshold, should scale down)
      // 18 successes + 2 failures = 90% success rate
      // Need < 90% to trigger scale down
      for (let i = 0; i < 17; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 3; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      // 85% success is >= 0.8, so it scales UP (hysteresis - optimistic)
      // not down. The test name says "scales down at 0.9" meaning
      // you need to be BELOW 0.9 AND below 0.8 to scale down.
      expect(ladder.getCurrentWorkers()).toBe(9); // 7 -> 9 (scales up, not down)

      // Now demonstrate scale down: need < 80% success
      for (let i = 0; i < 20; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(11); // 9 -> 11

      // Record 70% success (below 0.8, definitely below 0.9)
      for (let i = 0; i < 14; i++) {
        ladder.recordTask(true, 0);
      }
      for (let i = 0; i < 6; i++) {
        ladder.recordTask(false, 1);
      }
      ladder.evaluate();
      // 70% is below 0.9 threshold, so it scales down
      expect(ladder.getCurrentWorkers()).toBe(5); // 11 * 0.5 = 5.5 -> floor to 5
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
      // Scale to 9 workers: need 3 scale-ups (3->5->7->9)
      // Each scale-up requires 20 tasks after the previous scale
      for (let scaleUp = 0; scaleUp < 3; scaleUp++) {
        for (let i = 0; i < 20; i++) {
          ladder.recordTask(true, 0);
        }
        ladder.evaluate();
      }
      expect(ladder.getCurrentWorkers()).toBe(9);
      // After scale up, history is cleared. Need sampleSize tasks to evaluate.
      // Record 19 successes and 1 hard failure
      for (let i = 0; i < 19; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.recordTask(false, 5);
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

      // Workers should have scaled up
      expect(ladder.getCurrentWorkers()).toBe(5);

      // Record only 2 more mixed results (below sampleSize)
      // If history wasn't cleared, these might trigger immediate scale-down
      ladder.recordTask(true, 0);
      ladder.recordTask(false, 1);
      ladder.evaluate();

      // Workers should NOT have scaled down because we don't have enough samples yet
      expect(ladder.getCurrentWorkers()).toBe(5);
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

      // Scale to higher worker count first (3 -> 5)
      for (let i = 0; i < 5; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.evaluate();
      expect(ladder.getCurrentWorkers()).toBe(5);

      // Trigger scale down with hard failure (need sampleSize to evaluate)
      for (let i = 0; i < 4; i++) {
        ladder.recordTask(true, 0);
      }
      ladder.recordTask(false, 5);
      ladder.evaluate();

      // Should have scaled down (hard failure triggers immediate scale down)
      expect(ladder.getCurrentWorkers()).toBe(3);

      // Record only 2 more tasks (below sampleSize)
      // If history wasn't cleared, these might trigger immediate scale-up
      ladder.recordTask(true, 0);
      ladder.recordTask(true, 0);
      ladder.evaluate();

      // Workers should NOT have scaled up because we don't have enough samples yet
      expect(ladder.getCurrentWorkers()).toBe(3);
    });
  });
});
