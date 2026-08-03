# TTS Worker Pool Constraints

Lifecycle and retry rules for the Edge TTS WebSocket pool.

- Destroy a failed socket in the catch block. Never release it back to the pool.
- Clear all retry timers during cleanup. Ghost timers restart cancelled tasks.
- Delete the retry counter on success and on permanent failure. Stale counters leak memory.
- Check that the task total is above zero before a state update, so a cancelled run does not write progress.
- The task queue pauses on browser offline events and resumes when online. This protects the retry budget.
- A task that exhausts its retries is permanently failed and is written to a failure log file.
- There is no offline TTS fallback. A failed chunk stays failed.
