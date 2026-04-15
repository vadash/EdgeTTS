# ETA Fix Design: KISS/YAGNI Rewrite

**Date:** 2026-04-15
**Scope:** All pipeline stages (LLM Extract, LLM Assign, TTS Conversion, FFmpeg Merge)

## Problem Statement

ETA calculation is broken across all pipeline stages due to three root causes:

1. **`setStatus()` resets `phaseStartTime` on every call** - Even when status hasn't changed, causing elapsed time to be ~0ms and ETA to show `00:00:00`
2. **Wrong denominator in rate calculation** - Using `current - failed` caused division by zero when failures == successes
3. **Resume jumps cause impossible velocity** - When resuming from cache (e.g., 8725 chunks), the math becomes `(few ms) / 8725` = ~0ms per item

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single ETA calculation for all stages | DRY principle - all stages use same velocity-based approach |
| `phaseStartProgress` baseline field | Simple way to ignore cached items without complex state tracking |
| Idempotent `setStatus()` | Early return if status unchanged prevents timer resets from log messages |
| Exclude `failed` from rate calc | `current` already tracks successful items only; simpler math |
| Unified `report()` helper | All progress goes through one function - consistent updates |

## Changes

### 1. ConversionStore.ts

**New state field:**
```typescript
interface ConversionState {
  // ... existing fields ...
  phaseStartProgress: number;  // NEW: baseline for velocity calc
}
```

**Fixed `setStatus()`:**
```typescript
export function setStatus(newStatus: ConversionStatus): void {
  // CRITICAL: Don't reset if status hasn't changed
  if (conversion.value.status === newStatus) return;

  const newState = { ...conversion.value, status: newStatus };
  if (isProcessingStatus(newStatus)) {
    newState.phaseStartTime = Date.now();
    newState.phaseStartProgress = 0;
  }
  conversion.value = newState;
}
```

**Simplified `estimatedTimeRemaining`:**
```typescript
export const estimatedTimeRemaining = computed(() => {
  const { current, total } = conversion.value.progress;
  const start = conversion.value.phaseStartTime;
  const baseline = conversion.value.phaseStartProgress;

  if (!start || total === 0 || current === 0 || current >= total) return null;

  const elapsed = Date.now() - start;
  const processed = current - baseline;

  if (processed <= 0) return null;  // Need at least 1 item processed

  const timePerItem = elapsed / processed;
  const remainingItems = total - current;

  return formatDuration(remainingItems * timePerItem);
});
```

**New helper:**
```typescript
export function setPhaseBaseline(count: number): void {
  patchState({ phaseStartProgress: count });
}
```

### 2. stores/index.ts

Export the new helper:
```typescript
export { setPhaseBaseline, /* ... other exports ... */ } from './ConversionStore';
```

### 3. ConversionOrchestrator.ts

**DRY `report()` helper:**
```typescript
const report = (stage: string, current: number, total: number, message: string, failed = 0) => {
  logger.info(message);
  updateStatus(stage, stores);
  if (total > 0) {
    updateProgress(current, total, failed);
  }
};
```

**Resume handling:**
```typescript
if (audioMap.size > 0) {
  stores.conversion.setPhaseBaseline(audioMap.size);  // Ignore cached chunks
  report('tts-conversion', audioMap.size, chunks.length, `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`);
}
```

**Fixed `updateStatus()` (removed progress reset):**
```typescript
case 'tts-conversion':
  conversion.setStatus('converting');
  llm.setProcessingStatus('idle');
  // Removed: conversion.updateProgress(0, 0);
  break;
```

### 4. ConversionStore.test.ts

Update test expectations to match new math:
```typescript
// Before: (100 - 10 - 5) * (10s / 5) = 170s (wrong)
// After: (100 - 10) * (10s / 10) = 90s (correct)
expect(estimatedTimeRemaining.value).toBe('00:01:30');
```

## Verification

The fix should be verified by:

1. **Unit tests** - Updated test expectations pass
2. **TTS resume** - Large cached counts don't break ETA
3. **LLM stages** - Progress updates don't reset timer
4. **All stages** - ETA shows reasonable estimates throughout

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **This design** | Simple, DRY, handles resume | None significant |
| Per-stage ETA | Could be more accurate | Complex, YAGNI |
| Moving average | Smoother estimates | Over-engineered for this use case |

## References

- Review notes: `tmp/review.txt`
- Existing ETA logic: `src/stores/ConversionStore.ts`
- Orchestrator: `src/services/ConversionOrchestrator.ts`
