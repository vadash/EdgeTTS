# Bounded-retry TTS socket pool, no offline fallback

The TTS stage drives persistent Edge TTS sockets from a worker pool with a bounded retry budget. A chunk that exhausts its retries is permanently failed and written to a failure log file. There is no offline TTS fallback; a failed chunk stays failed.

## Consequences

- A failed socket is destroyed in the catch block; never release it back to the pool.
- Cleanup clears all retry timers (ghost timers restart cancelled tasks) and deletes the retry counter on success and on permanent failure (stale counters leak memory).
- The task total is checked above zero before a state update, so a cancelled run does not write progress.
- The task queue pauses on browser offline events and resumes when online; this protects the retry budget.
