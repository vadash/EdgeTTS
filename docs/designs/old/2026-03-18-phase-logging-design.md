# Phase Logging Design

**Status:** Proposed
**Date:** 2026-03-18
**Related Commit:** 7be5c88 (selective error logging)

## Overview

Extend the `DebugLogger` to save the first request and response from each LLM phase (extract, merge, assign) to the `logs/` folder. Unlike error logging which only saves on data-quality errors, phase logs will be saved on every conversion run to aid in debugging and development.

## Background

The current `DebugLogger` has `saveErrorLog()` which saves request/response pairs with sequential naming (`r1.json`/`a1.json`) only when data-quality errors occur (Zod validation failures, JSON parse errors). This design adds complementary logging for the first successful call of each phase.

## File Structure

```
logs/
├── extract_request.json   # First extract call
├── extract_response.json  # First extract response
├── merge_request.json     # First merge call
├── merge_response.json    # First merge response
├── assign_request.json    # First assign call
├── assign_response.json   # First assign response
├── r1.json                # Error logs (existing)
├── a1.json                # Error logs (existing)
└── ...
```

## Design

### Changes to `DebugLogger`

**Location:** `src/services/llm/DebugLogger.ts`

```typescript
export class DebugLogger {
  private errorCounter: number = 0;
  private loggedPhases: Set<string> = new Set(); // NEW: Track logged phases

  // ... existing methods ...

  /** Save first request/response for a phase (extract, merge, assign) */
  async savePhaseLog(
    phase: 'extract' | 'merge' | 'assign',
    requestBody: object,
    responseContent: object
  ): Promise<void> {
    // Only save once per phase per conversion
    if (this.loggedPhases.has(phase)) return;

    this.loggedPhases.add(phase);

    const reqFile = `${phase}_request.json`;
    const respFile = `${phase}_response.json`;

    await this.saveLog(reqFile, requestBody);
    await this.saveLog(respFile, responseContent);
  }

  /** Reset error counter AND phase tracking for a new conversion */
  resetLogging(): void {
    this.errorCounter = 0;
    this.loggedPhases.clear(); // NEW: Reset phase tracking
  }
}
```

### Integration Points

**Location:** `src/services/llm/LLMVoiceService.ts`

1. **`extractCharacters()` method** - Save first extract call (first block):
   ```typescript
   const response = await withRetry(() => this.apiClient.callStructured(...));
   allCharacters.push(...response.characters);

   // NEW: Save first extract phase log
   if (i === 0) {
     await this.apiClient.debugLogger?.savePhaseLog(
       'extract',
       extractMessages,     // or request body
       response
     );
   }
   ```

2. **`singleMerge()` method** - Save first merge call:
   ```typescript
   const response = await withRetry(() => client.callStructured(...));

   // NEW: Save first merge phase log (need to pass debugLogger)
   await client.debugLogger?.savePhaseLog('merge', ...);
   ```

3. **`processAssignBlock()` method** - Save first assign call:
   ```typescript
   const response = await withRetry(() => this.apiClient.callStructured(...));

   // NEW: Save first assign phase log
   await this.apiClient.debugLogger?.savePhaseLog('assign', ...);
   ```

### Key Decisions

1. **Always save, not just on error** - Unlike error logging, phase logs save on every conversion to provide visibility into normal operation.

2. **First call only** - Each phase saves only the first request/response. Subsequent calls within the same conversion are ignored. This keeps logs focused and avoids duplicate files.

3. **Shared reset mechanism** - `resetLogging()` now resets both error counter and phase tracking, keeping the lifecycle aligned.

4. **Coexistence with error logs** - Phase logs use descriptive names (`extract_request.json`) while error logs use sequential naming (`r1.json`/`a1.json`). They can coexist in the same folder without conflict.

5. **Request body capture** - Need to capture the actual request body sent to the API (including model, messages, schema) for useful debugging.

## Testing Strategy

1. **Unit tests** for `savePhaseLog()`:
   - First call saves files
   - Subsequent calls for same phase are ignored
   - Different phases each save once
   - `resetLogging()` clears phase tracking

2. **Integration tests** for `LLMVoiceService`:
   - Verify phase files are created after conversion
   - Verify only first call per phase is logged
   - Verify `resetLogging()` clears state between conversions

## Open Questions

None at this time.

## Implementation Checklist

- [ ] Add `loggedPhases` Set to `DebugLogger`
- [ ] Add `savePhaseLog()` method to `DebugLogger`
- [ ] Update `resetLogging()` to clear `loggedPhases`
- [ ] Add phase logging to `extractCharacters()` (first block only)
- [ ] Add phase logging to `singleMerge()` (first vote only)
- [ ] Add phase logging to `processAssignBlock()` (first block only)
- [ ] Add unit tests for `DebugLogger.savePhaseLog()`
- [ ] Add integration tests for phase logging in `LLMVoiceService`
- [ ] Update `DebugLogger` tests for `resetLogging()` behavior
