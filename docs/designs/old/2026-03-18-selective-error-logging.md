# Design: Selective Error Logging

## Summary

Change debug logging from "always log" to "log only on specific data-quality errors" with sequential naming (r1.json/a1.json, r2.json/a2.json).

## Current Behavior

- `DebugLogger.saveLog()` always saves `structured_request.json` and `structured_response.json` on first call
- Uses `shouldLog(pass)` / `markLogged(pass)` to prevent duplicate logs per pass type
- Logs clutter the user's selected directory (e.g., `D:\books\logs`)

## Desired Behavior

### When to Save

Only save debug logs when these "data quality" errors occur:
- **Zod validation errors** - LLM returned JSON that doesn't match schema
- **JSON parse errors** - LLM returned malformed JSON (even after repair attempts)
- **Empty outputs** - LLM returned no content at all

### When NOT to Save

Skip logging for "infrastructure" errors:
- Provider down / network errors
- Rate limiting (429)
- Authentication errors (401/403)
- Timeout errors
- CORS errors

### File Naming

Sequential counter-based naming:
- `r1.json` - first failed request
- `a1.json` - first failed response
- `r2.json` / `a2.json` - second failure
- Continue incrementing per error occurrence

## Design

### Changes to DebugLogger

```typescript
// Remove: shouldLog(), markLogged(), logged Set
// Remove: per-pass-type logging logic

// Add: error counter
private errorCounter: number = 0;

// Add: method to save error logs with sequential naming
async saveErrorLog(requestBody: object, responseContent: string): Promise<void> {
  if (!this.directoryHandle) return;

  this.errorCounter++;
  const reqFile = `r${this.errorCounter}.json`;
  const respFile = `a${this.errorCounter}.json`;

  // Save request
  await this.saveFile(reqFile, requestBody);
  // Save response
  await this.saveFile(respFile, { content: responseContent });
}

// Keep: resetLogging() to reset counter on new conversion
resetLogging(): void {
  this.errorCounter = 0;
}
```

### Changes to callStructured (LLMApiClient)

```typescript
async callStructured<T>({ messages, schema, schemaName }: StructuredCallOptions<T>): Promise<T> {
  // ... build requestBody ...

  // Remove: automatic debug logging
  // if (this.debugLogger?.shouldLog('structured')) {
  //   this.debugLogger.saveLog('structured_request.json', requestBody);
  // }

  let content: string;
  try {
    // ... make API call ...
    content = await this.makeApiCall(requestBody);
  } catch (error) {
    // Infrastructure errors - don't log
    throw error;
  }

  // Try to parse/validate
  try {
    return safeParseJSON(content, schema);
  } catch (error) {
    // Data quality errors - save debug logs
    if (isDataQualityError(error)) {
      await this.debugLogger?.saveErrorLog(requestBody, content);
    }
    throw error;
  }
}

// Helper to identify save-worthy errors
function isDataQualityError(error: unknown): boolean {
  return error instanceof ZodError ||
    (error instanceof RetriableError && (
      error.message.includes('JSON') ||
      error.message.includes('Empty response')
    ));
}
```

### Error Classification

| Error Type | Save Logs? | Reason |
|------------|------------|--------|
| `ZodError` | YES | Schema mismatch - need to debug |
| JSON parse fail | YES | Malformed output - need to debug |
| Empty response | YES | No output - need to debug |
| HTTP 4xx/5xx | NO | Provider/infrastructure issue |
| Network error | NO | Connectivity issue |
| Timeout | NO | Provider slow/down |
| Rate limit | NO | Usage limit hit |

## Migration

1. Remove `shouldLog()`, `markLogged()`, and `logged` Set from DebugLogger
2. Add `errorCounter` and `saveErrorLog()` method
3. Remove automatic logging from `callStructured()`
4. Add error detection and conditional logging after `safeParseJSON()`
5. Update tests

## Benefits

- **Less clutter** - Only debug when something actually goes wrong
- **Sequential naming** - Easy to correlate request/response pairs
- **Focus on actionable errors** - Logs only for fixable issues (data quality), not transient issues (provider down)
