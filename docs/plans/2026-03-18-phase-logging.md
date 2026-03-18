# Phase Logging Implementation Plan

**Goal:** Extend `DebugLogger` to save first request and response from each LLM phase (extract, merge, assign) to the `logs/` folder.

**Architecture:**
- `DebugLogger` tracks which phases have been logged using a `Set<string>` and saves only the first call per phase
- Phase logs use descriptive filenames (`extract_request.json`, `extract_response.json`) and coexist with error logs (`r1.json`, `a1.json`)
- `LLMVoiceService` integrates phase logging into `extractCharacters()`, `singleMerge()`, and `processAssignBlock()` methods
- `resetLogging()` clears both error counter and phase tracking for each conversion run

**Tech Stack:** TypeScript, Vitest

---

## File Structure Overview

- **Modify:** `src/services/llm/DebugLogger.ts` - add `loggedPhases` Set, `savePhaseLog()` method, update `resetLogging()`
- **Modify:** `src/services/llm/DebugLogger.test.ts` - add tests for `savePhaseLog()` and updated `resetLogging()`
- **Modify:** `src/services/llm/LLMVoiceService.ts` - integrate phase logging into extract, merge, and assign methods
- **Modify:** `src/services/llm/LLMApiClient.ts` - expose request body for phase logging capture

---

## Task 1: Add savePhaseLog() and loggedPhases to DebugLogger

**Purpose:** Add the new phase logging method that saves request/response pairs with descriptive filenames, tracking which phases have already been logged.

**Common Pitfalls:**
- The `loggedPhases` Set must be checked BEFORE saving to ensure only first call per phase is logged
- `resetLogging()` must clear both the error counter AND the phase tracking Set
- Must handle null directoryHandle gracefully (no-op)

**Files:**
- Modify: `src/services/llm/DebugLogger.ts`
- Test: `src/services/llm/DebugLogger.test.ts`

### Step 1: Write the failing test

Add to `src/services/llm/DebugLogger.test.ts` (after the existing `saveErrorLog does nothing when no directory handle` test):

```typescript
  it('savePhaseLog writes phase_request.json and phase_response.json files', async () => {
    const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.savePhaseLog('extract', { model: 'gpt-4', messages: [] }, { characters: [] });

    // Should save extract_request.json and extract_response.json
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', { create: true });

    // Verify content was written
    const writeCalls = mockWritable.write.mock.calls;
    expect(writeCalls[0][0]).toContain('gpt-4'); // request content
    expect(writeCalls[1][0]).toContain('characters'); // response content
  });

  it('savePhaseLog only logs first call per phase', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    // First call should save
    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', { create: true });

    // Reset the mock to check second call
    mockLogsFolder.getFileHandle.mockClear();

    // Second call for same phase should be ignored
    await logger.savePhaseLog('extract', { req: 2 }, { res: 2 });
    expect(mockLogsFolder.getFileHandle).not.toHaveBeenCalled();
  });

  it('savePhaseLog logs different phases independently', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    // Log extract phase
    await logger.savePhaseLog('extract', { phase: 'extract' }, { result: 'extract' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_request.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('extract_response.json', { create: true });

    // Log merge phase - should also save
    await logger.savePhaseLog('merge', { phase: 'merge' }, { result: 'merge' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('merge_request.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('merge_response.json', { create: true });

    // Log assign phase - should also save
    await logger.savePhaseLog('assign', { phase: 'assign' }, { result: 'assign' });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('assign_request.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('assign_response.json', { create: true });
  });

  it('resetLogging clears phase tracking', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    // First call saves
    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledTimes(2); // request + response

    mockLogsFolder.getFileHandle.mockClear();

    // Reset logging
    logger.resetLogging();

    // After reset, should save again
    await logger.savePhaseLog('extract', { req: 2 }, { res: 2 });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledTimes(2); // request + response
  });

  it('savePhaseLog does nothing when no directory handle', async () => {
    const logger = new DebugLogger(null);
    // Should not throw
    await logger.savePhaseLog('extract', { req: 1 }, { res: 1 });
  });
```

### Step 2: Run test to verify it fails

Run:
```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** FAIL with "savePhaseLog is not a function"

### Step 3: Write minimal implementation

Modify `src/services/llm/DebugLogger.ts`:

```typescript
import type { Logger } from '../Logger';

/**
 * Handles debug log file persistence to the user's file system.
 * Extracted from LLMApiClient to respect SRP.
 */
export class DebugLogger {
  private errorCounter: number = 0;
  private loggedPhases: Set<string> = new Set();

  constructor(
    private directoryHandle: FileSystemDirectoryHandle | null | undefined,
    private logger?: Logger,
  ) {}

  /** Save a JSON object to the logs/ subfolder */
  async saveLog(filename: string, content: object): Promise<void> {
    if (!this.directoryHandle) return;
    try {
      const logsFolder = await this.directoryHandle.getDirectoryHandle('logs', { create: true });
      const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(content, null, 2));
      await writable.close();
    } catch (e) {
      this.logger?.warn('Failed to save log', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Save request and response when an error occurs. Uses sequential naming: r1.json/a1.json, r2.json/a2.json */
  async saveErrorLog(requestBody: object, responseContent: string): Promise<void> {
    if (!this.directoryHandle) return;

    this.errorCounter++;
    const reqFile = `r${this.errorCounter}.json`;
    const respFile = `a${this.errorCounter}.json`;

    // Save request
    await this.saveLog(reqFile, requestBody);
    // Save response (wrap in object for consistent structure)
    await this.saveLog(respFile, { content: responseContent });
  }

  /** Save first request/response for a phase (extract, merge, assign) */
  async savePhaseLog(
    phase: 'extract' | 'merge' | 'assign',
    requestBody: object,
    responseContent: object,
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
    this.loggedPhases.clear();
  }
}
```

### Step 4: Run test to verify it passes

Run:
```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** PASS

### Step 5: Commit

```bash
git add -A && git commit -m "feat: add savePhaseLog() with phase tracking to DebugLogger"
```

---

## Task 2: Add Phase Logging to extractCharacters()

**Purpose:** Save the first extract phase request/response when processing text blocks.

**Common Pitfalls:**
- Only log on the first block (i === 0), not every block
- Need to capture the actual request body including messages and schema
- The `extractMessages` variable already contains the built prompt

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

### Step 1: Identify integration point

In `extractCharacters()` method, locate the loop that processes blocks:

```typescript
for (let i = 0; i < blocks.length; i++) {
  // ... existing code ...
  const response = await withRetry(
    () =>
      this.apiClient.callStructured({
        messages: buildExtractPrompt(blockText),
        schema: ExtractSchema,
        schemaName: 'ExtractSchema',
        signal: controller.signal,
      }),
    // ...
  );
  // ...
}
```

### Step 2: Write the implementation

Modify `src/services/llm/LLMVoiceService.ts` in the `extractCharacters()` method:

Replace this section (around line 160-175):

```typescript
      const response = await withRetry(
        () =>
          this.apiClient.callStructured({
            messages: buildExtractPrompt(blockText),
            schema: ExtractSchema,
            schemaName: 'ExtractSchema',
            signal: controller.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.extract, // Keep retrying until valid
          signal: controller.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[Extract] Block ${i + 1}/${blocks.length} retry ${attempt}: ${getErrorMessage(error)}`,
            );
          },
        },
      );

      allCharacters.push(...response.characters);
```

With:

```typescript
      const extractMessages = buildExtractPrompt(blockText);
      const response = await withRetry(
        () =>
          this.apiClient.callStructured({
            messages: extractMessages,
            schema: ExtractSchema,
            schemaName: 'ExtractSchema',
            signal: controller.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.extract, // Keep retrying until valid
          signal: controller.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[Extract] Block ${i + 1}/${blocks.length} retry ${attempt}: ${getErrorMessage(error)}`,
            );
          },
        },
      );

      allCharacters.push(...response.characters);

      // Save first extract phase log
      if (i === 0) {
        await this.apiClient.debugLogger?.savePhaseLog('extract', { messages: extractMessages }, response);
      }
```

### Step 3: Run tests to verify no regressions

Run:
```bash
npm test -- src/services/llm/extract.test.ts
```

**Expected:** PASS

### Step 4: Commit

```bash
git add -A && git commit -m "feat: add phase logging to extractCharacters()"
```

---

## Task 3: Add Phase Logging to singleMerge()

**Purpose:** Save the first merge phase request/response during character merging.

**Common Pitfalls:**
- The merge client (`this.mergeApiClient`) may be different from `this.apiClient` when separate merge config is provided
- Need to pass the debugLogger to the temporary client created in `singleMerge()`
- Only log on the first successful vote (vote index === 0)

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

### Step 1: Update singleMerge() method signature and body

Modify `src/services/llm/LLMVoiceService.ts` in the `singleMerge()` method:

Replace the method signature and implementation:

```typescript
  /**
   * Single merge operation with specified temperature using structured outputs
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    _onProgress?: ProgressCallback,
    voteIndex?: number, // NEW: track which vote this is
  ): Promise<number[][] | null> {
    this.logger?.info(
      `[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`,
    );

    // Create a client with the specified temperature
    const client = new LLMApiClient({
      apiKey: this.options.mergeConfig?.apiKey ?? this.options.apiKey,
      apiUrl: this.options.mergeConfig?.apiUrl ?? this.options.apiUrl,
      model: this.options.mergeConfig?.model ?? this.options.model,
      streaming: false, // Always non-streaming for structured outputs
      reasoning: this.options.mergeConfig?.reasoning ?? this.options.reasoning,
      temperature: temperature,
      topP: this.options.mergeConfig?.topP ?? this.options.topP,
      debugLogger: this.apiClient.debugLogger, // NEW: share debugLogger
      logger: this.logger,
    });

    const mergeMessages = buildMergePrompt(characters);

    try {
      const response = await withRetry(
        () =>
          client.callStructured({
            messages: mergeMessages,
            schema: MergeSchema,
            schemaName: 'MergeSchema',
            signal: this.abortController?.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.merge,
          signal: this.abortController?.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[Merge] Retry ${attempt}/${RETRY_CONFIG.merge} (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
            );
          },
        },
      );

      // Save first merge phase log
      if (voteIndex === 0) {
        await this.apiClient.debugLogger?.savePhaseLog('merge', { messages: mergeMessages }, response);
      }

      return response.merges;
    } catch (error) {
      this.logger?.warn(
        `[Merge] Vote failed after ${RETRY_CONFIG.merge} retries (temp=${temperature.toFixed(2)}): ${getErrorMessage(error)}`,
      );
      return null;
    }
  }
```

### Step 2: Update call site to pass voteIndex

In the same file, find `mergeCharactersWithLLM()` and update the call to `singleMerge()`:

Replace:
```typescript
      const mergeGroups = await this.singleMerge(characters, temp, onProgress);
```

With:
```typescript
      const mergeGroups = await this.singleMerge(characters, temp, onProgress, i);
```

### Step 3: Run tests to verify no regressions

Run:
```bash
npm test -- src/services/llm/merge.test.ts
```

**Expected:** PASS

### Step 4: Commit

```bash
git add -A && git commit -m "feat: add phase logging to singleMerge()"
```

---

## Task 4: Add Phase Logging to processAssignBlock()

**Purpose:** Save the first assign phase request/response during speaker assignment.

**Common Pitfalls:**
- The `processAssignBlock()` method creates temporary clients for voting, so we need to ensure logging happens with the main apiClient
- Only log on the first block (need a way to track if we've logged assign yet)
- The non-voting path uses `this.apiClient` directly, while the voting path creates temporary clients

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

### Step 1: Add instance variable to track first assign block

Add a new private instance variable to the `LLMVoiceService` class (after the existing private fields):

```typescript
export class LLMVoiceService {
  private options: LLMVoiceServiceOptions;
  private apiClient: LLMApiClient;
  public mergeApiClient: LLMApiClient;
  private abortController: AbortController | null = null;
  private logger: Logger;
  private isFirstAssignBlock: boolean = true; // NEW: track first assign block
```

### Step 2: Reset the flag in assignSpeakers()

Add in `assignSpeakers()` method, near the beginning (after the abortController setup):

```typescript
    this.abortController = new AbortController();
    this.isFirstAssignBlock = true; // NEW: reset for new conversion
```

### Step 3: Add phase logging in processAssignBlock()

Modify `processAssignBlock()` to capture and log the first assign call.

In the non-voting path (after the single call succeeds), add:

```typescript
      // Convert sparse object to Map
      relativeMap = new Map();
      for (const [key, code] of Object.entries(response.assignments)) {
        const index = parseInt(key, 10);
        if (context.codeToName.has(code)) {
          relativeMap.set(index, code);
        }
      }

      // Save first assign phase log (non-voting path)
      if (this.isFirstAssignBlock) {
        await this.apiClient.debugLogger?.savePhaseLog('assign', { messages: assignMessages }, response);
        this.isFirstAssignBlock = false;
      }
```

In the voting path (after collecting valid responses and before the fallback), add:

```typescript
      // Check if all voting attempts failed - fall back to narrator
      const validResponses = responses.filter((r): r is object => r !== null);
      if (validResponses.length === 0) {
        // ... existing fallback code ...
      }

      // Save first assign phase log (voting path - log first successful vote)
      if (this.isFirstAssignBlock && validResponses.length > 0) {
        await this.apiClient.debugLogger?.savePhaseLog('assign', { messages: assignMessages }, validResponses[0]);
        this.isFirstAssignBlock = false;
      }
```

The complete modifications:

Find this section in the voting path (around line 350):

```typescript
      // Check if all voting attempts failed - fall back to narrator
      const validResponses = responses.filter((r): r is object => r !== null);
      if (validResponses.length === 0) {
        this.logger?.warn(
          `[assign] Block at ${block.sentenceStartIndex} failed (all voting attempts), using default voice for ${block.sentences.length} sentences`,
        );
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }
```

Add after `validResponses` is defined but before the `if (validResponses.length === 0)` check:

```typescript
      // Save first assign phase log (voting path)
      if (this.isFirstAssignBlock && validResponses.length > 0) {
        await this.apiClient.debugLogger?.savePhaseLog('assign', { messages: assignMessages }, validResponses[0]);
        this.isFirstAssignBlock = false;
      }
```

Find this section in the non-voting path (around line 405):

```typescript
        // Convert sparse object to Map
        relativeMap = new Map();
        for (const [key, code] of Object.entries(response.assignments)) {
          const index = parseInt(key, 10);
          if (context.codeToName.has(code)) {
            relativeMap.set(index, code);
          }
        }
```

Add after this block:

```typescript
        // Save first assign phase log (non-voting path)
        if (this.isFirstAssignBlock) {
          await this.apiClient.debugLogger?.savePhaseLog('assign', { messages: assignMessages }, response);
          this.isFirstAssignBlock = false;
        }
```

### Step 4: Run tests to verify no regressions

Run:
```bash
npm test -- src/services/llm/assign.test.ts
```

**Expected:** PASS

### Step 5: Commit

```bash
git add -A && git commit -m "feat: add phase logging to processAssignBlock()"
```

---

## Task 5: Run Full Test Suite

**Purpose:** Ensure no regressions in related tests.

### Step 1: Run all LLM-related tests

Run:
```bash
npm test -- src/services/llm/
```

**Expected:** All tests PASS

### Step 2: Run type check

Run:
```bash
npm run typecheck
```

**Expected:** No type errors

### Step 3: Final commit

```bash
git add -A && git commit -m "test: verify phase logging integration"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `DebugLogger.ts` | Added `loggedPhases` Set, `savePhaseLog()` method, updated `resetLogging()` to clear phase tracking |
| `DebugLogger.test.ts` | Added tests for `savePhaseLog()` and updated `resetLogging()` tests |
| `LLMVoiceService.ts` | Integrated phase logging into `extractCharacters()`, `singleMerge()`, and `processAssignBlock()` |

## File Output Locations

After a conversion run with phase logging enabled, the `logs/` folder will contain:

```
logs/
├── extract_request.json    # First extract API call
├── extract_response.json   # First extract response
├── merge_request.json      # First merge API call
├── merge_response.json     # First merge response
├── assign_request.json     # First assign API call
├── assign_response.json    # First assign response
├── r1.json                 # First error log (if any)
├── a1.json                 # First error response (if any)
└── ...                     # Additional error logs
```

## Phase Logging Behavior

| Phase | When Logged | Condition |
|-------|-------------|-----------|
| extract | After first successful block | `i === 0` in block loop |
| merge | After first successful vote | `voteIndex === 0` in vote loop |
| assign | After first successful block | `isFirstAssignBlock === true` |

All phase tracking is reset when `resetLogging()` is called (at the start of `extractCharacters()`).
