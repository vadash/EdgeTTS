# Selective Error Logging Implementation Plan

**Goal:** Change debug logging from "always log" to "log only on data-quality errors" with sequential naming (r1.json/a1.json).

**Architecture:**
- `DebugLogger` manages error counter and saves request/response pairs on error
- `LLMApiClient` detects data-quality errors (ZodError, JSON parse fail, empty response) and triggers debug logging only for those
- Infrastructure errors (network, timeout, rate limit) don't trigger logging

**Tech Stack:** TypeScript, Vitest, Zod

---

## File Structure Overview

- **Modify:** `src/services/llm/DebugLogger.ts` - add `saveErrorLog()`, remove `shouldLog()`/`markLogged()`, keep `resetLogging()`
- **Modify:** `src/services/llm/LLMApiClient.ts` - remove automatic logging, add error-triggered logging
- **Modify:** `src/services/llm/DebugLogger.test.ts` - test new `saveErrorLog()` and counter behavior
- **Modify:** `src/services/llm/LLMApiClient.structured.test.ts` - test error-triggered logging

---

## Task 1: Add saveErrorLog() to DebugLogger

**Purpose:** Add the new error-triggered logging method with sequential naming.

**Common Pitfalls:**
- The counter must increment BEFORE generating filenames so r1/a1 is the first pair
- Must handle null directoryHandle gracefully (no-op)

**Files:**
- Modify: `src/services/llm/DebugLogger.ts`
- Test: `src/services/llm/DebugLogger.test.ts`

### Step 1: Write the failing test

Add to `src/services/llm/DebugLogger.test.ts` (before the closing brace of describe):

```typescript
  it('saveErrorLog writes sequential rN.json and aN.json files', async () => {
    const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ model: 'gpt-4', messages: [] }, '{"invalid": json}');

    // First error should be r1.json and a1.json
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a1.json', { create: true });

    // Verify content was written
    const writeCalls = mockWritable.write.mock.calls;
    expect(writeCalls[0][0]).toContain('gpt-4'); // request content
    expect(writeCalls[1][0]).toContain('{\"invalid\": json}'); // response content
  });

  it('saveErrorLog increments counter for each call', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ req: 1 }, 'response 1');
    await logger.saveErrorLog({ req: 2 }, 'response 2');

    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a1.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r2.json', { create: true });
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('a2.json', { create: true });
  });

  it('resetLogging resets error counter', async () => {
    const { mockDirHandle, mockLogsFolder } = createMockDirectoryHandle();
    const logger = new DebugLogger(mockDirHandle);

    await logger.saveErrorLog({ req: 1 }, 'response 1');
    logger.resetLogging();
    await logger.saveErrorLog({ req: 2 }, 'response 2');

    // After reset, should start at 1 again
    expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('r1.json', { create: true });
    // Should NOT have r2.json
    const r2Calls = mockLogsFolder.getFileHandle.mock.calls.filter(
      (call: any[]) => call[0] === 'r2.json'
    );
    expect(r2Calls).toHaveLength(0);
  });

  it('saveErrorLog does nothing when no directory handle', async () => {
    const logger = new DebugLogger(null);
    // Should not throw
    await logger.saveErrorLog({ req: 1 }, 'response');
  });
```

### Step 2: Run test to verify it fails

```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** FAIL with "saveErrorLog is not a function"

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

  /** Reset error counter for a new conversion */
  resetLogging(): void {
    this.errorCounter = 0;
  }
}
```

### Step 4: Run test to verify it passes

```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** PASS

### Step 5: Commit

```bash
git add -A && git commit -m "feat: add saveErrorLog() with sequential naming to DebugLogger"
```

---

## Task 2: Remove Legacy Logging Methods from DebugLogger

**Purpose:** Remove the old `shouldLog()`/`markLogged()` system that's no longer needed.

**Files:**
- Modify: `src/services/llm/DebugLogger.ts`
- Test: `src/services/llm/DebugLogger.test.ts`

### Step 1: Update tests to remove legacy method tests

Remove this test from `src/services/llm/DebugLogger.test.ts`:

```typescript
  // REMOVE THIS TEST:
  it('tracks first-call-per-pass via shouldLog/markLogged', () => {
    const logger = new DebugLogger(null);
    expect(logger.shouldLog('extract')).toBe(true);
    logger.markLogged('extract');
    expect(logger.shouldLog('extract')).toBe(false);

    // Reset
    logger.resetLogging();
    expect(logger.shouldLog('extract')).toBe(true);
  });
```

### Step 2: Run test to verify it fails

```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** Tests still pass (we removed a test, not added functionality)

### Step 3: Remove legacy methods from implementation

The DebugLogger.ts from Task 1 already removed these methods, so no changes needed.

### Step 4: Run all tests to verify

```bash
npm test -- src/services/llm/DebugLogger.test.ts
```

**Expected:** PASS

### Step 5: Commit

```bash
git add -A && git commit -m "refactor: remove legacy shouldLog/markLogged from DebugLogger"
```

---

## Task 3: Add Error-Triggered Logging to LLMApiClient

**Purpose:** Remove automatic logging and add conditional logging only for data-quality errors.

**Common Pitfalls:**
- Must import `ZodError` from zod to check error type
- Must still throw the error after logging - logging is side effect, not error handling
- Need to catch from `safeParseJSON()` specifically

**Files:**
- Modify: `src/services/llm/LLMApiClient.ts`
- Test: `src/services/llm/LLMApiClient.structured.test.ts`

### Step 1: Write the failing test

Add to `src/services/llm/LLMApiClient.structured.test.ts` (before closing brace of describe block):

```typescript
  it('saves debug logs on Zod validation error', async () => {
    const TestSchema = z.object({
      requiredField: z.string(),
    });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"missing": "field"}', // Missing requiredField
            refusal: null,
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    await expect(
      (client as any).callStructured({
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow();

    // Should have saved error logs
    expect(mockSaveErrorLog).toHaveBeenCalledTimes(1);
    const [requestBody, responseContent] = mockSaveErrorLog.mock.calls[0];
    expect(requestBody).toHaveProperty('model', 'gpt-4o-mini');
    expect(responseContent).toBe('{"missing": "field"}');
  });

  it('does NOT save debug logs on infrastructure errors', async () => {
    const TestSchema = z.object({ value: z.string() });

    // Simulate network error
    mockCreate.mockRejectedValue(new Error('Network Error'));

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    await expect(
      (client as any).callStructured({
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Network Error');

    // Should NOT have saved error logs for infrastructure errors
    expect(mockSaveErrorLog).not.toHaveBeenCalled();
  });

  it('does NOT save debug logs on successful parse', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"value": "success"}',
            refusal: null,
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    const result = await (client as any).callStructured({
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'success' });
    // Should NOT have saved error logs on success
    expect(mockSaveErrorLog).not.toHaveBeenCalled();
  });
```

### Step 2: Run test to verify it fails

```bash
npm test -- src/services/llm/LLMApiClient.structured.test.ts
```

**Expected:** FAIL - new tests fail because saveErrorLog not called yet

### Step 3: Write implementation

Modify `src/services/llm/LLMApiClient.ts`:

1. Add import at top:
```typescript
import { ZodError } from 'zod';
```

2. Modify `callStructured` method - replace the entire method with:

```typescript
  /**
   * Call LLM with structured output enforcement.
   * Returns validated, typed result directly.
   *
   * @param options - Structured call options including prompt, schema, schema name
   * @returns Parsed and validated result matching the schema
   * @throws Error if LLM refuses or returns empty response
   */
  async callStructured<T>({ messages, schema, schemaName }: StructuredCallOptions<T>): Promise<T> {
    const useStreaming = this.options.streaming ?? false;

    const requestBody: Record<string, unknown> = {
      model: this.options.model,
      messages,
      stream: useStreaming,
      response_format: zodToJsonSchema(schema, schemaName),
      enable_thinking: this.options.reasoning !== null,
    };

    applyProviderFixes(requestBody, this.provider);

    this.logger?.info(`[structured] API call starting (streaming: ${useStreaming})...`);

    let content: string;

    if (useStreaming) {
      // Streaming path: accumulate SSE chunks
      try {
        const streamResult = await this.client.chat.completions.create({
          ...requestBody,
          stream: true,
        } as any);

        const stream = streamResult as unknown as AsyncIterable<ChatCompletionChunk>;

        let accumulated = '';
        let finishReason: string | null = null;

        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              accumulated += delta.content;
            }
            if (chunk.choices[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
          }
        } catch (error) {
          throw new RetriableError(`Streaming failed: ${(error as Error).message}`, error as Error);
        }

        if (finishReason === 'content_filter') {
          throw new RetriableError('Response refused by content filter');
        }

        if (!accumulated) {
          throw new RetriableError('Empty response from LLM');
        }

        content = accumulated;
      } catch (error) {
        throw new RetriableError(
          `LLM API call failed: ${(error as Error).message}`,
          error as Error,
        );
      }
    } else {
      // Non-streaming path
      let response: ChatCompletion;
      try {
        response = await this.client.chat.completions.create({
          ...requestBody,
          stream: false,
        } as any);
        response = response as ChatCompletion;
      } catch (error) {
        throw new RetriableError(
          `LLM API call failed: ${(error as Error).message}`,
          error as Error,
        );
      }

      const message = response.choices[0]?.message;

      if (message?.refusal) {
        throw new RetriableError(`LLM refused: ${message.refusal}`);
      }

      if (!message?.content) {
        throw new RetriableError('Empty response from LLM');
      }

      content = message.content;
    }

    this.logger?.info(`[structured] API call completed (${content.length} chars)`);

    // Try to parse and validate the response
    try {
      return safeParseJSON(content, schema);
    } catch (error) {
      // Save debug logs only for data-quality errors
      if (this.isDataQualityError(error)) {
        await this.debugLogger?.saveErrorLog(requestBody, content);
      }
      throw error;
    }
  }

  /**
   * Check if an error is a data-quality error that should trigger debug logging.
   * Data-quality errors: Zod validation errors, JSON parse errors, empty responses.
   * Infrastructure errors (network, timeout, rate limit) return false.
   */
  private isDataQualityError(error: unknown): boolean {
    // Zod validation errors indicate schema mismatch
    if (error instanceof ZodError) {
      return true;
    }
    // RetriableError with JSON/Empty response indicates data quality issue
    if (error instanceof RetriableError) {
      return (
        error.message.includes('JSON') ||
        error.message.includes('Empty response')
      );
    }
    return false;
  }
```

3. Remove the old `resetLogging()` method from LLMApiClient (it just delegates to debugLogger, keep it but it can be simplified):

The existing method is fine:
```typescript
  /**
   * Reset logging flags for new conversion
   */
  resetLogging(): void {
    this.debugLogger?.resetLogging();
  }
```

### Step 4: Run test to verify it passes

```bash
npm test -- src/services/llm/LLMApiClient.structured.test.ts
```

**Expected:** PASS

### Step 5: Commit

```bash
git add -A && git commit -m "feat: add selective error logging to LLMApiClient"
```

---

## Task 4: Run Full Test Suite

**Purpose:** Ensure no regressions in related tests.

### Step 1: Run all LLM-related tests

```bash
npm test -- src/services/llm/
```

**Expected:** All tests PASS

### Step 2: Run type check

```bash
npm run typecheck
```

**Expected:** No type errors

### Step 3: Final commit

```bash
git add -A && git commit -m "test: update tests for selective error logging feature"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `DebugLogger.ts` | Added `errorCounter`, `saveErrorLog()`, removed `shouldLog()`/`markLogged()` |
| `LLMApiClient.ts` | Removed automatic logging, added `isDataQualityError()`, calls `saveErrorLog()` only on data errors |
| `DebugLogger.test.ts` | Added tests for `saveErrorLog()`, removed legacy tests |
| `LLMApiClient.structured.test.ts` | Added tests verifying logs saved only on ZodError, not on infrastructure errors |

## Error Classification Reference

| Error Type | `isDataQualityError()` | Reason |
|------------|------------------------|--------|
| `ZodError` | ✅ YES | Schema validation failed |
| `RetriableError` with "JSON" message | ✅ YES | JSON parse/repair failed |
| `RetriableError` with "Empty response" | ✅ YES | No content from LLM |
| Network errors | ❌ NO | Infrastructure issue |
| Timeout errors | ❌ NO | Infrastructure issue |
| Rate limit errors | ❌ NO | Usage limit, not data quality |
| Content filter | ❌ NO | Policy issue, not data format |
