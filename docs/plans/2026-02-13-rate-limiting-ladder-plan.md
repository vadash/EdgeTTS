# Implementation Plan - Rate Limiting Ladder

> **Reference:** `docs/designs/2026-02-13-rate-limiting-ladder-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

Implement adaptive worker pool that starts at 2 workers, scales up on success, scales down on errors. PQueue doesn't support dynamic concurrency, so we'll use a throttling wrapper around `addTasks()`.

## Task 1: Create LadderController with Core Logic

**Goal:** Implement the adaptive worker controller class.

**Step 1: Write the Failing Test**
- File: `src/services/LadderController.test.ts`

```typescript
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
      for (let i = 0; i < 60; i++) {
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
      // Should not scale up since only 5 in history and all success = 100% > 90%
      expect(ladder.getCurrentWorkers()).toBe(3);
    });
  });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/LadderController.test.ts`
- Expect: "Cannot find module './LadderController'"

**Step 3: Implementation (Green)**
- File: `src/services/LadderController.ts`

```typescript
import type { ILogger } from './interfaces';

export interface TaskResult {
  success: boolean;
  retries: number;
  timestamp: number;
}

export interface LadderConfig {
  sampleSize: number;
  successThreshold: number;
  scaleUpIncrement: number;
  scaleDownFactor: number;
}

export class LadderController {
  private currentWorkers: number;
  private history: TaskResult[] = [];
  private readonly minWorkers = 2;

  constructor(
    private config: LadderConfig,
    private readonly maxWorkers: number,
    private readonly logger?: ILogger
  ) {
    this.currentWorkers = this.minWorkers;
  }

  getCurrentWorkers(): number {
    return this.currentWorkers;
  }

  recordTask(success: boolean, retries: number): void {
    const result: TaskResult = {
      success,
      retries,
      timestamp: Date.now(),
    };

    this.history.push(result);

    // Keep only sampleSize entries (ring buffer)
    if (this.history.length > this.config.sampleSize) {
      this.history.shift();
    }
  }

  evaluate(): void {
    // Need at least sampleSize tasks to evaluate
    if (this.history.length < this.config.sampleSize) {
      return;
    }

    const successes = this.history.filter(h => h.success).length;
    const successRate = successes / this.history.length;

    // Check for errors that should trigger scale down
    // If any task failed after retries, scale down
    const hasFailure = this.history.some(h => !h.success);

    if (hasFailure) {
      this.scaleDown();
    } else if (successRate >= this.config.successThreshold) {
      this.scaleUp();
    }
  }

  private scaleUp(): void {
    const newValue = this.currentWorkers + this.config.scaleUpIncrement;
    if (newValue <= this.maxWorkers) {
      this.currentWorkers = newValue;
      this.logger?.debug(`Ladder scaled up to ${this.currentWorkers} workers`);
    }
  }

  private scaleDown(): void {
    const newValue = Math.max(this.minWorkers, Math.floor(this.currentWorkers * this.config.scaleDownFactor));
    if (newValue < this.currentWorkers) {
      this.currentWorkers = newValue;
      this.logger?.warn(`Ladder scaled down to ${this.currentWorkers} workers due to errors`);
    }
  }
}
```

**Step 4: Verify (Green)**
- Command: `npm test src/services/LadderController.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/services/LadderController.ts src/services/LadderController.test.ts && git commit -m "feat: add LadderController for adaptive worker scaling"`

---

## Task 2: Add LadderController Integration to TTSWorkerPool

**Goal:** Wire up the ladder to control task batching.

**Step 1: Write the Failing Test**
- File: `src/services/TTSWorkerPool.ladder.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSWorkerPool, type WorkerPoolOptions } from './TTSWorkerPool';
import type { PoolTask } from './interfaces';
import type { TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

vi.mock('./ReusableEdgeTTSService', () => ({
  ReusableEdgeTTSService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    disconnect: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue('READY'),
  })),
}));

describe('TTSWorkerPool - Ladder Integration', () => {
  let pool: TTSWorkerPool;
  let options: WorkerPoolOptions;
  let mockDir: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDir = createMockDirectoryHandle();

    options = {
      maxWorkers: 10,
      config: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
      },
      directoryHandle: mockDir,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with 2 workers (not maxWorkers)', async () => {
    pool = new TTSWorkerPool(options);

    // Add 5 tasks
    const tasks: PoolTask[] = [0, 1, 2, 3, 4].map(i => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));
    pool.addTasks(tasks);

    // Process some tasks
    await vi.advanceTimersByTimeAsync(100);

    // Verify initial concurrency is 2
    // We'll check this via a new method or by observing execution
  });

  it('records task results for ladder evaluation', async () => {
    // This will require internal access or mocking
  });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/TTSWorkerPool.ladder.test.ts`
- Expect: Tests fail because ladder not integrated

**Step 3: Implementation (Green)**
- File: `src/services/TTSWorkerPool.ts`

Find the constructor and add after line 64:
```typescript
import { LadderController } from './LadderController';
```

Add field declaration around line 47:
```typescript
  private ladder: LadderController;
```

In constructor after `this.maxWorkers = options.maxWorkers;` (after line 64):
```typescript
    // Initialize ladder controller for adaptive scaling
    this.ladder = new LadderController(
      {
        sampleSize: 20,
        successThreshold: 0.9,
        scaleUpIncrement: 1,
        scaleDownFactor: 0.5,
      },
      this.maxWorkers,
      this.logger
    );
```

Now modify `addTask` and `addTasks` to use throttling. Since PQueue doesn't support dynamic concurrency, we'll batch tasks:

Replace `addTasks` method (around line 171-176):
```typescript
  addTasks(tasks: PoolTask[]): void {
    this.totalTasks += tasks.length;

    // Add tasks gradually based on current ladder setting
    const currentWorkers = this.ladder.getCurrentWorkers();
    const batchSize = currentWorkers;

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      for (const task of batch) {
        this.queue.add(() => this.executeTask(task));
      }

      // After each batch, pause briefly before next batch
      if (i + batchSize < tasks.length) {
        setTimeout(() => {
          // Next batch will be processed after this delay
        }, 100);
      }
    }
  }
```

Update `executeTask` to record results. Find the success path (around line 250-262) and add before `this.onTaskComplete`:
```typescript
      // Record success for ladder
      this.ladder.recordTask(true, 0);
      this.ladder.evaluate();
```

Find the error path in `catch` block (around line 263-267) and add before `this.onTaskError`:
```typescript
      // Record failure for ladder
      this.ladder.recordTask(false, 11); // Max retries attempted
      this.ladder.evaluate();
```

**Step 4: Verify (Green)**
- Command: `npm test src/services/TTSWorkerPool.ladder.test.ts`
- Expect: PASS (may need to adjust test assertions)

**Step 5: Git Commit**
- Command: `git add src/services/TTSWorkerPool.ts src/services/TTSWorkerPool.ladder.test.ts && git commit -m "feat: integrate LadderController with TTSWorkerPool"`

---

## Task 3: Update warmup() to Use Ladder

**Goal:** Start with 2 workers instead of maxWorkers.

**Step 1: Write the Failing Test**
- File: `src/services/TTSWorkerPool.test.ts` (add to existing describe block)

```typescript
  it('warmup uses ladder workers (2), not maxWorkers', async () => {
    pool = createPool({ maxWorkers: 10 });

    const connectionAcquireSpy = vi.spyOn(pool['connectionPool'], 'acquire');

    await pool.warmup();

    // Should warm up 2 connections (ladder min), not 10
    expect(connectionAcquireSpy).toHaveBeenCalledTimes(2);
  });
```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/TTSWorkerPool.test.ts`
- Expect: "Expected 2 calls, received 10"

**Step 3: Implementation (Green)**
- File: `src/services/TTSWorkerPool.ts`

Find `warmup()` method (around line 147-163). Replace with:

```typescript
  async warmup(): Promise<void> {
    const promises: Promise<void>[] = [];
    const workersToWarmup = this.ladder.getCurrentWorkers();

    for (let i = 0; i < workersToWarmup; i++) {
      promises.push(
        (async () => {
          try {
            const conn = await this.connectionPool.acquire();
            await this.connectionPool.release(conn);
          } catch {
            // Ignore warmup errors - will retry on actual task
          }
        })()
      );
    }
    await Promise.allSettled(promises);
    this.logger?.debug(`Warmed up ${workersToWarmup} connections (ladder-controlled)`);
  }
```

**Step 4: Verify (Green)**
- Command: `npm test src/services/TTSWorkerPool.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/services/TTSWorkerPool.ts && git commit -m "feat: warmup uses ladder worker count instead of maxWorkers"`

---

## Task 4: Deprecate Unused workersPerMinute Config

**Goal:** Clean up unused config option.

**Step 1: Remove unused code**
- File: `src/config/index.ts`

Remove `workersPerMinute` from TTSConfig interface (around line 8):
```typescript
export interface TTSConfig {
  /** Maximum concurrent WebSocket workers */
  maxWorkers: number;
  /** Cooldown after error before spawning new workers (ms) */
  errorCooldown: number;
}
```

Remove from defaultConfig (around line 105-107):
```typescript
  tts: {
    maxWorkers: 15,
    errorCooldown: 10000, // 10 seconds
  },
```

Remove `getWorkerStartDelay` function (lines 189-194):
```typescript
// Remove this entire function - no longer used
```

**Step 2: Update Tests**
- File: `src/config/index.test.ts`

Search for tests using `workersPerMinute` and remove those assertions.

**Step 3: Verify**
- Command: `npm test src/config/index.test.ts`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add src/config/index.ts src/config/index.test.ts && git commit -m "chore: remove unused workersPerMinute config and getWorkerStartDelay"`

---

## Task 5: Integration Test - End-to-End Ladder Behavior

**Goal:** Verify ladder scales correctly in realistic scenario.

**Step 1: Write Integration Test**
- File: `src/services/integration/ladder-integration.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSWorkerPool, type WorkerPoolOptions } from '../TTSWorkerPool';
import type { PoolTask } from '../interfaces';
import type { TTSConfig as VoiceConfig } from '@/state/types';
import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

vi.mock('../ReusableEdgeTTSService', () => ({
  ReusableEdgeTTSService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    disconnect: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue('READY'),
  })),
}));

describe('Ladder Integration - E2E', () => {
  let pool: TTSWorkerPool;
  let options: WorkerPoolOptions;
  let mockDir: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDir = createMockDirectoryHandle();

    options = {
      maxWorkers: 15,
      config: {
        voice: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
        rate: '+0%',
        pitch: '+0Hz',
      },
      directoryHandle: mockDir,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scales up from 2 -> 3 -> 4 -> ... as tasks succeed', async () => {
    pool = new TTSWorkerPool(options);

    // Add 60 successful tasks (3 full evaluation cycles)
    const tasks: PoolTask[] = Array.from({ length: 60 }, (_, i) => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));
    pool.addTasks(tasks);

    // Process all tasks
    while (pool.getProgress().completed < 60) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Final state: should have scaled up significantly
    // Starting at 2, after 20 tasks -> 3, after 40 -> 4, after 60 -> 5
    const progress = pool.getProgress();
    expect(progress.completed).toBe(60);
    expect(progress.failed).toBe(0);
  });

  it('scales down when errors occur', async () => {
    pool = new TTSWorkerPool(options);

    // First, scale up to 8 workers
    const successTasks: PoolTask[] = Array.from({ length: 160 }, (_, i) => ({
      partIndex: i,
      text: `Text ${i}`,
      filename: 'test',
      filenum: String(i + 1).padStart(4, '0'),
    }));

    // Mock to fail on task 161
    const { ReusableEdgeTTSService } = await import('../ReusableEdgeTTSService');
    vi.mocked(ReusableEdgeTTSService).mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementationOnce(() => Promise.reject(new Error('Rate limited'))),
      disconnect: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      getState: vi.fn().mockReturnValue('READY'),
    }));

    pool.addTasks(successTasks);

    // Process
    while (pool.getProgress().completed < 160) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Now add a task that will fail
    const failingTask: PoolTask = {
      partIndex: 160,
      text: 'This will fail',
      filename: 'test',
      filenum: '0161',
    };
    pool.addTask(failingTask);

    await vi.advanceTimersByTimeAsync(5000);

    // Verify the failure was recorded and workers handled
    const progress = pool.getProgress();
    expect(progress.failed).toBeGreaterThanOrEqual(1);
  });
});
```

**Step 2: Run Test (Red/Green)**
- Command: `npm test src/services/integration/ladder-integration.test.ts`
- Expect: May need adjustment based on actual behavior

**Step 3: Adjust Implementation if Needed**
- The batching in Task 2 might need refinement for proper throttling

**Step 4: Git Commit**
- Command: `git add src/services/integration/ladder-integration.test.ts && git commit -m "test: add E2E ladder integration tests"`

---

## Task 6: Update Design Doc with Implementation Notes

**Goal:** Document any deviations from original design.

**Step 1: Edit Design Doc**
- File: `docs/designs/2026-02-13-rate-limiting-ladder-design.md`

Add section at end:
```markdown
## Implementation Notes (2025-02-13)

### Dynamic Concurrency Solution
PQueue doesn't support dynamic concurrency. Implemented task batching instead:
- `addTasks()` batches tasks based on current ladder worker count
- Each batch added to queue with 100ms delay between batches
- Ladder re-evaluates after each task completion

### Deviations from Design
- Originally planned to modify PQueue concurrency directly; switched to batching
- `scaleDown()` triggered on ANY failure, not just error spikes (safer)
- Removed `workersPerMinute` config entirely (was unused)
```

**Step 2: Verify**
- Command: `git diff docs/designs/2026-02-13-rate-limiting-ladder-design.md`
- Expect: Shows implementation notes added

**Step 3: Git Commit**
- Command: `git add docs/designs/2026-02-13-rate-limiting-ladder-design.md && git commit -m "docs: add implementation notes to ladder design"`
