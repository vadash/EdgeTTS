# TTS Failure Logging

**Goal:** Log chunk content and error message when a TTS chunk fails permanently (after 11 retries).

## Implementation

### 1. Add `directoryHandle` to `WorkerPoolOptions`

```typescript
// src/services/TTSWorkerPool.ts
interface WorkerPoolOptions {
  maxWorkers: number;
  config: VoiceConfig;
  chunkStore?: ChunkStore | null;
  directoryHandle?: FileSystemDirectoryHandle | null;  // ADD THIS
  onStatusUpdate?: (update: StatusUpdate) => void;
  onTaskError?: (partIndex: number, error: Error) => void;
  onAllComplete?: () => void;
  logger?: Logger;
}
```

### 2. Add private method to write failure log

```typescript
// Inside TTSWorkerPool class
private failureLogCounter = 0;

private async logTTSFailure(task: PoolTask, error: unknown): Promise<void> {
  if (!this.options.directoryHandle) return;

  try {
    const logsFolder = await this.options.directoryHandle.getDirectoryHandle('logs', { create: true });
    this.failureLogCounter++;
    const filename = `tts_fail${this.failureLogCounter}.json`;

    const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    const logEntry = {
      partIndex: task.partIndex,
      text: task.text,
      errorMessage: error instanceof Error ? error.message : String(error),
      retryCount: 11,
      timestamp: new Date().toISOString(),
    };

    await writable.write(JSON.stringify(logEntry, null, 2));
    await writable.close();
  } catch (e) {
    // Non-fatal: logging failure shouldn't break the conversion
    this.logger?.warn('Failed to write TTS failure log', { error: e });
  }
}
```

### 3. Call `logTTSFailure()` in permanent failure path

```typescript
// In handleTaskFailure(), when attempt > 11:
if (attempt > 11) {
  // Permanent failure
  await this.logTTSFailure(task, error);  // ADD THIS

  this.ladder.recordTask(false, 11);
  this.ladder.evaluate();
  this.failedTasks.add(task.partIndex);
  this.processedCount++;
  this.onTaskError?.(task.partIndex, error instanceof Error ? error : new Error(String(error)));
  this.retryCount.delete(task.partIndex);
  return;
}
```

### 4. Pass `directoryHandle` from ConversionOrchestrator

```typescript
// src/services/ConversionOrchestrator.ts
// When creating TTSWorkerPool, pass directoryHandle:
const workerPool = createWorkerPool({
  maxWorkers: settings.ttsThreads.value,
  config: voiceConfig,
  chunkStore,
  directoryHandle,  // ADD THIS
  onStatusUpdate: (update) => { /* ... */ },
  onTaskError: (partIndex, error) => { /* ... */ },
  logger: logs,
});
```

## Log File Format

`logs/tts_fail1.json`:
```json
{
  "partIndex": 123,
  "text": "The quick brown fox jumps over the lazy dog.",
  "errorMessage": "WebSocket closed during request",
  "retryCount": 11,
  "timestamp": "2026-04-15T12:34:56.789Z"
}
```

## Testing

- Add one test to verify `logTTSFailure` creates file with correct content
- Mock `FileSystemDirectoryHandle` with `getFileHandle` spy
- Verify file not created when `directoryHandle` is null
- No integration test needed — covered by existing retry tests

## Notes

- Reuses existing `logs/` folder (same as LLM DebugLogger)
- Sequential naming (`tts_fail1.json`, `tts_fail2.json`) avoids write conflicts
- Non-fatal if logging fails (wrapped in try/catch)
- Minimal data: partIndex, text, errorMessage, retryCount, timestamp
