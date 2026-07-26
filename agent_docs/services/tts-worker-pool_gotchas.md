# TTS Worker Pool Constraints

Lifecycle and retry rules for `TTSWorkerPool` (Edge TTS WebSockets, scaled by `LadderController`).

- **Destroy on Failure**: Call `await this.connectionPool.destroy(service)` in catch blocks. Never `release()` a failed socket.
- **Clear Timers**: Call `clearTimeout` on all `retryTimers` during `cleanup()`/`clear()` to stop ghost tasks.
- **Clear State**: Call `retryCount.delete(task.partIndex)` on success OR permanent failure to prevent memory leaks.
- **Cancellation Guard**: Verify `this.totalTasks > 0` in `executeTask` before updating state.
- **Queue Pausing**: `p-queue` pauses on `offline` events and resumes on `online` events to preserve retry budget.
- **Failure Logs**: Permanent task failures (5 retries) write gracefully to `logs/tts_fail*.json`.
