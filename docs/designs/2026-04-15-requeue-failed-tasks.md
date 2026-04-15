# Re-enqueue Failed Tasks Design

**Date:** 2025-01-15
**Author:** Claude
**Status:** Design

## Problem Statement

### Current Behavior
The TTSWorkerPool uses `p-retry`'s `withRetry()` wrapper which implements exponential backoff **inline**. When a task fails:
1. The worker sleeps for 10-600 seconds while holding both:
   - A PQueue concurrency slot
   - A generic-pool WebSocket connection

2. When a batch of chunks hits network issues (common in large conversions), all 15 workers get stuck sleeping
3. The pipeline becomes paralyzed - healthy chunks wait in queue while workers sleep on failing chunks

### Evidence from Production Log
```
[00:00:05] Converting 107362 chunks to audio...
[00:00:05] Resuming: found 3044/107362 cached chunks
[00:00:11] Part 2310: Retry 1...
[00:00:30] Part 2310: Retry 2...
[00:01:11] Part 2310: Retry 3...
...
[01:06:37] Part 2310: Retry 12...
[01:06:37] Part 2310 failed: WebSocket closed during request
[01:18:17] Written 3500/107362 files
```

Only 456 new chunks completed in 1h22m (3044 → 3500). Workers were blocked on retries.

## Solution: Re-enqueue Failed Tasks

Instead of sleeping inline, failed tasks are immediately re-queued with a calculated delay. This frees worker slots to process healthy chunks.

### Architecture Changes

**Before (Current):**
```
acquire connection
  ↓
withRetry(send())
  ├─ success → write chunk, release
  └─ failure → sleep inline (holds slot + connection)
```

**After (Proposed):**
```
acquire connection
  ↓
try { send() }
  ├─ success → write chunk, release connection
  └─ failure →
     ├─ destroy connection (not release!)
     ├─ calculate delay
     ├─ setTimeout(() => requeue(task), delay)
     └─ worker freed immediately
```

## Components

### 1. Retry State Management

```typescript
private retryCount = new Map<number, number>();
private retryTimers = new Map<number, NodeJS.Timeout>();
```

- **retryCount**: Tracks how many times each `partIndex` has failed
- **retryTimers**: Stores pending `setTimeout` handles for cleanup
- Both are **in-memory only** - lost on page refresh (acceptable per requirements)

### 2. Re-enqueue Logic

Replace `withRetry` wrapper with direct try/catch:

```typescript
private async executePrimaryTask(task: PoolTask): Promise<void> {
  let service: ReusableEdgeTTSService | null = null;

  try {
    service = await this.connectionPool.acquire();

    // Try TTS request (no withRetry wrapper)
    const audioData = await service.send({
      text: task.text,
      config: taskConfig,
    });

    // Success path
    await this.chunkStore!.writeChunk(task.partIndex, audioData);
    this.ladder.recordTask(true, 0);  // Success with 0 retries
    this.onTaskComplete?.(task.partIndex, String(task.partIndex));
    this.retryCount.delete(task.partIndex);  // Clear retry state

    await this.connectionPool.release(service);
  } catch (error) {
    // CRITICAL: Destroy tainted connection, not release
    await this.connectionPool.destroy(service);

    // Handle retry logic
    await this.handleTaskFailure(task, error);
  }
}
```

### 3. Failure Handler

```typescript
private async handleTaskFailure(task: PoolTask, error: unknown): Promise<void> {
  const currentAttempt = (this.retryCount.get(task.partIndex) || 0) + 1;
  this.retryCount.set(task.partIndex, currentAttempt);

  const maxRetries = 11;

  if (currentAttempt > maxRetries) {
    // Permanent failure
    this.ladder.recordTask(false, maxRetries);
    this.ladder.evaluate();
    this.failedTasks.add(task.partIndex);
    this.processedCount++;
    this.onTaskError?.(task.partIndex, error as Error);
    this.retryCount.delete(task.partIndex);

    this.onStatusUpdate?.({
      partIndex: task.partIndex,
      message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Failed after ${maxRetries} retries`,
      isComplete: false,
    });
  } else {
    // Schedule retry
    const delay = this.calculateRetryDelay(currentAttempt);

    this.onStatusUpdate?.({
      partIndex: task.partIndex,
      message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Failed. Retrying in ${Math.round(delay / 1000)}s (Attempt ${currentAttempt})`,
      isComplete: false,
    });

    const timer = setTimeout(() => {
      this.requeueTask(task);
      this.retryTimers.delete(task.partIndex);
    }, delay);

    this.retryTimers.set(task.partIndex, timer);
  }
}
```

### 4. Re-enqueue Method

```typescript
private requeueTask(task: PoolTask): void {
  // Check for cancellation before re-enqueuing
  // (Implementation depends on cancellation signal design)

  this.onStatusUpdate?.({
    partIndex: task.partIndex,
    message: `Part ${String(task.partIndex + 1).padStart(4, '0')}: Retrying now...`,
    isComplete: false,
  });

  // Add back to queue - will acquire fresh connection
  this.queue.add(() => this.executePrimaryTask(task));
}
```

### 5. Backoff Calculation

Reuse existing exponential backoff formula:

```typescript
private calculateRetryDelay(attempt: number): number {
  const baseDelay = 10 * 1000;  // 10 seconds
  const maxDelay = 600 * 1000;  // 10 minutes
  const jitter = Math.random() * 1000;

  return Math.min(baseDelay * 2 ** (attempt - 1) + jitter, maxDelay);
}
```

**Delay progression:**
- Retry 1: ~10s
- Retry 2: ~20s
- Retry 3: ~40s
- Retry 4: ~80s
- Retry 5: ~160s
- Retry 6-11: ~600s (max)

### 6. Cleanup Handling

**Critical:** Prevent "ghost" tasks from waking up after cancellation.

```typescript
async cleanup(): Promise<void> {
  // Clear all pending retry timers
  for (const timer of this.retryTimers.values()) {
    clearTimeout(timer);
  }
  this.retryTimers.clear();
  this.retryCount.clear();

  // Existing cleanup...
  await this.connectionPool.drain();
  await this.connectionPool.clear();

  if (this.chunkStore) {
    await this.chunkStore.close();
  }
}

clear(): void {
  // Clear all pending retry timers
  for (const timer of this.retryTimers.values()) {
    clearTimeout(timer);
  }
  this.retryTimers.clear();
  this.retryCount.clear();

  // Existing clear...
  this.queue.clear();
}
```

## Critical Design Decisions

### 1. Destroy vs Release Connections

**Decision:** On failure, call `this.connectionPool.destroy(service)` instead of `release(service)`.

**Rationale:** When a WebSocket request fails (e.g., `WebSocket closed during request`), the connection is tainted or dead. Releasing it back to the pool risks another task acquiring a broken connection. `generic-pool` will automatically spin up a fresh WebSocket for the next task.

### 2. PQueue `idle` Event Safety

**Decision:** Keep existing completion logic unchanged.

**Rationale:** The current check `if (this.processedCount === this.totalTasks)` remains valid because `processedCount` only increments on success or permanent failure (after 11 retries). The `idle` event may fire while tasks are sleeping in background timers, but `onAllComplete` won't trigger until the final task wakes and updates the count.

### 3. LadderController Integration

**Decision:** Only record final states to LadderController.

- **Success:** `recordTask(true, 0)` - zero retries
- **Intermediate failure (retry < 11):** Do NOT record - avoids triggering `hasHardFailure` scale-down (which looks for `retries >= 10`)
- **Permanent failure (retry 11):** `recordTask(false, 11)` and evaluate

**Rationale:** Intermediate retries are transient and shouldn't trigger adaptive scaling. Only permanent failures indicate systemic issues requiring scale-down.

### 4. UI Status Updates

**Decision:** Fire `onStatusUpdate` twice during retry cycle.

1. **On failure:** `Part XXXX: Failed. Retrying in 30s (Attempt 3)`
2. **On re-enqueue execution:** `Part XXXX: Retrying now...`

**Rationale:** Prevents user perception that the app froze when tasks are in background timers.

## Data Flow

```
addTask(task)
  ↓
queue.add(() => executePrimaryTask(task))
  ↓
[In executePrimaryTask]:
  1. service = await pool.acquire()
  2. try:
     audio = await service.send({text, config})
     await chunkStore.writeChunk(audio)
     ladder.recordTask(true, 0)
     await pool.release(service)
     retryCount.delete(partIndex)
  3. catch (error):
     await pool.destroy(service)  // Destroy, not release!
     await handleTaskFailure(task, error)

[In handleTaskFailure]:
  attempt = retryCount.get(partIndex) + 1
  retryCount.set(partIndex, attempt)

  if attempt > 11:
    ladder.recordTask(false, 11)
    failedTasks.add(partIndex)
    onTaskError(partIndex, error)
  else:
    delay = calculateRetryDelay(attempt)
    onStatusUpdate({ message: "Retrying in ${delay}s..." })
    timer = setTimeout(() => requeueTask(task), delay)
    retryTimers.set(partIndex, timer)

[In requeueTask]:
  onStatusUpdate({ message: "Retrying now..." })
  queue.add(() => executePrimaryTask(task))
  retryTimers.delete(partIndex)
```

## Error Handling

| Error Type | Handling |
|------------|----------|
| **TTS request failure** | Destroy connection, calculate backoff, re-enqueue |
| **Permanent failure (11 retries)** | Mark failed, notify error callback, clear retry state |
| **Cancellation during retry** | Clear timeout in `clear()`, task never wakes |
| **WebSocket closed** | Treated as permanent (likely content issue, not transient) |
| **Request timeout** | Retried with exponential backoff |

## Testing Strategy

### Unit Tests

1. **Retry state tracking:**
   - Verify `retryCount` increments on failure
   - Verify `retryCount` clears on success
   - Verify max retries enforced

2. **Backoff calculation:**
   - Test delay progression (10s → 20s → 40s...)
   - Verify max delay cap (600s)
   - Verify jitter randomness

3. **Connection handling:**
   - Mock `pool.destroy()` called on failure
   - Mock `pool.release()` called on success
   - Verify no reuse of destroyed connections

4. **Cleanup:**
   - Mock `clearTimeout` called for all timers
   - Verify maps cleared
   - Test cancellation during active retry

### Integration Tests

1. **Network failure simulation:**
   - Simulate batch of failures
   - Verify workers stay free
   - Verify healthy chunks processed during retries

2. **Completion logic:**
   - Verify `onAllComplete` fires after final retry
   - Verify not fired early during background timers

### Manual Test

Run actual conversion with network issues:
- Monitor log for "Retrying in Xs" messages
- Verify healthy chunks complete during retry delays
- Verify no worker starvation

## Implementation Checklist

- [x] Add `retryCount` and `retryTimers` Maps to class
- [x] Implement `calculateRetryDelay()` method
- [x] Implement `handleTaskFailure()` method
- [x] Implement `requeueTask()` method
- [x] Modify `executePrimaryTask()` to remove `withRetry` wrapper
- [x] Change failure handling to `destroy()` instead of `release()`
- [x] Add timeout clearing to `cleanup()` and `clear()`
- [x] Update `onStatusUpdate` calls for retry messages
- [x] Update LadderController calls (only final states)
- [x] Write unit tests
- [x] Write integration tests
- [x] Manual testing with real conversion

## Trade-offs

| Pro | Con |
|-----|-----|
| Workers stay free during retries | In-memory retry state lost on refresh |
| Better throughput on unstable networks | More complex than `withRetry` wrapper |
- Predictable backoff behavior | Requires manual cleanup of timers |
| Preserves existing retry limits | |

## Alternatives Considered

1. **Lower retry limits only:** Addresses symptom but doesn't fix root cause (worker starvation)
2. **Separate retry worker pool:** More complex, unnecessary with re-enqueue approach
3. **Fast-fail detection:** Complementary enhancement, can be added later

## References

- Original issue: Log showing 1h22m for 456 chunks due to retry starvation
- `generic-pool` docs: `destroy()` vs `release()` semantics
- `p-queue` docs: Re-enqueue patterns
- `LadderController` source: `hasHardFailure` detection (`retries >= 10`)
