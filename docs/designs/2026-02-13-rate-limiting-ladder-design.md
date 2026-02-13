# Design: Rate Limiting Ladder for Edge TTS

**Date:** 2025-02-13
**Status:** Design Complete
**Target:** TTSWorkerPool rate limiting and connection management

## 1. Problem Statement

Currently, `maxWorkers: 15` allows 15 concurrent WebSocket connections to the free Edge TTS endpoint. While bans are rare and short-lived (5-10 minutes), aggressive connection spawning can trigger rate limiting.

**Current Issues:**
- `warmup()` spawns ALL 15 workers immediately with no delay
- `workersPerMinute: 50` config exists but is NOT used
- `getWorkerStartDelay()` function exists but is NEVER called
- No scaling down when errors occur
- No scaling up strategy - always max concurrency

## 2. Goals & Non-Goals

### Must Do
- Implement adaptive worker pool that starts conservative and scales up
- Auto-scale down when errors detected
- Preserve existing `maxWorkers` as hard ceiling (15)
- Keep retry logic intact

### Won't Do
- UI controls for rate limiting (auto-adjust only)
- Per-voice configuration (keep it simple)
- Persistent storage of learned rates (restart = reset to 2)

## 3. Proposed Architecture

### High-Level Approach

Add a **LadderController** inside `TTSWorkerPool` that:
1. Tracks recent task success/failure rate
2. Dynamically adjusts `p-queue` concurrency
3. Implements gradual step-down on errors

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    TTSWorkerPool                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              LadderController (NEW)                  │   │
│  │  - recentTasks: RingBuffer<TaskResult, 20>          │   │
│  │  - currentWorkers: number (starts at 2)             │   │
│  │  - evaluate(): update concurrency based on success   │   │
│  │  - scaleUp(): increment workers by 1                │   │
│  │  - scaleDown(): reduce by 50%, min 2                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  - queue: PQueue (concurrency controlled by Ladder)          │
│  - connectionPool: generic-pool (max stays 15)             │
└─────────────────────────────────────────────────────────────┘
```

### Integration Points

1. **Task execution** (`executeTask`):
   - Before task: check if we can scale up
   - After task: record result (success/failure)
   - Every N tasks: run `evaluate()`

2. **Error handling** (existing retry logic):
   - On failure after retries: record as failure
   - Trigger `scaleDown()` immediately

## 4. Data Models / Schema

```typescript
// Task result for ladder tracking
interface TaskResult {
  success: boolean;
  retries: number;
  timestamp: number;
}

// Ladder state
interface LadderState {
  currentWorkers: number;        // Active concurrency (starts at 2)
  maxWorkers: number;             // Ceiling (15)
  minWorkers: number;             // Floor (2)
  history: TaskResult[];          // Last 20 tasks
}

// Configuration for ladder behavior
interface LadderConfig {
  sampleSize: number;             // How many tasks to evaluate (default: 20)
  successThreshold: number;        // Success rate to scale up (default: 0.9)
  scaleUpIncrement: number;       // Workers to add (default: 1)
  scaleDownFactor: number;         // Percentage to reduce (default: 0.5)
}
```

## 5. Interface / API Design

```typescript
class LadderController {
  constructor(config: LadderConfig, maxWorkers: number, logger?: ILogger)

  // Get current worker count (for PQueue concurrency)
  getCurrentWorkers(): number;

  // Record task completion
  recordTask(success: boolean, retries: number): void;

  // Evaluate history and adjust workers
  evaluate(): void;

  // Scale up by increment
  private scaleUp(): void;

  // Scale down by factor (gradual step down)
  private scaleDown(): void;
}

// Inside TTSWorkerPool:
private ladder: LadderController;

// In constructor:
this.ladder = new LadderController(
  { sampleSize: 20, successThreshold: 0.9, scaleUpIncrement: 1, scaleDownFactor: 0.5 },
  this.maxWorkers,
  this.logger
);

// Update queue concurrency dynamically
this.queue = new PQueue({
  concurrency: () => this.ladder.getCurrentWorkers()
});
```

## 6. Risks & Edge Cases

### Risk: PQueue doesn't support dynamic concurrency
**Mitigation:** `p-queue` doesn't natively support dynamic concurrency. Solution:
- Use `max: 15` in PQueue and let ladder control how many tasks are ADDED per batch
- OR use manual task throttling before queue.add()

### Risk: Spurious errors cause unnecessary scale-down
**Mitigation:**
- Only scale down if error persists after retry logic (already have 11 retries)
- Gradual step down (50%) means 15 → 8 → 4 → 2, not instant drop

### Risk: Small job batches never reach scale-up threshold
**Mitigation:**
- Only scale up AFTER `sampleSize` tasks completed
- Small jobs (< 20 tasks) stay at conservative 2 workers (acceptable)

### Risk: Memory leak from unbounded history
**Mitigation:**
- Use fixed-size ring buffer (max 20 entries)
- Shift old results out, never grow beyond sampleSize

## 7. Testing Strategy

1. **Unit tests** (`LadderController.test.ts`):
   - Scale up after 90% success rate
   - Scale down on error spike
   - Respect min/max boundaries

2. **Integration tests** (`TTSWorkerPool.test.ts`):
   - Verify PQueue respects ladder concurrency
   - Verify warmup uses ladder, not maxWorkers

3. **Manual testing**:
   - Run 100-block conversion
   - Monitor worker count over time via logs
   - Verify graceful degradation on intentional failure

## 8. Implementation Checklist

- [ ] Create `src/services/LadderController.ts`
- [ ] Modify `TTSWorkerPool` to use ladder
- [ ] Update `warmup()` to start with 2 workers (not 15)
- [ ] Remove/disable `workersPerMinute` config (or repurpose)
- [ ] Add unit tests for LadderController
- [ ] Update integration tests
- [ ] Update design doc with implementation notes
