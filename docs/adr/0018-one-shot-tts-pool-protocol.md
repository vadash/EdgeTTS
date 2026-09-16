# ADR-0018: One-shot TTS pool protocol

Date: 2026-09-17
Status: Accepted

## Context

TTSWorkerPool grew an imperative, multi-call lifecycle: callers warmed it up
(`warmup`), fed it tasks across two methods (`addTask`/`addTasks`), polled it
for state (`getProgress`, `getCompletedAudio`, `getFailedTasks`,
`getPoolStats`), and tore it down explicitly (`cleanup`/`clear`). Settlement
was implicit — the pool fired `onAllComplete` from a queue-idle listener and
the orchestrator resolved a hand-rolled `new Promise` around it. Cancellation
was a dead abort listener that called `clear()` without settling anything, so
a mid-flight abort hung the TTS stage forever (debt noted in
[ADR-0017](0017-one-cancellation-encoding.md)). Retry reporting leaked through
`onStatusUpdate` string objects that the orchestrator filtered with
`message.includes('Retry')`. Permanent-failure diagnostics were written to a
side channel of `logs/tts_failN.json` files driven by a `directoryHandle`
option, disconnected from the failure log that actually gates resume.

## Decision

The pool's entire public surface is `create(config)` plus
`run(tasks, { signal })` resolving a `PoolOutcome`
(`{ completed: Set<number>; failed: Array<{ index, message }> }`). `run`
settles when every task is completed or permanently failed: the pool then
tears itself down (retry timers, offline listeners, socket pool drain) before
resolving. An aborting signal fast-settles the run: in-flight sockets are
destroyed, queued and backoff-timer tasks are dropped without waiting for a
graceful drain, and the promise rejects with `CancellationError` — the one
cancellation encoding. A pre-aborted signal rejects before any work is
created; a cancelled run records no progress and unfinished chunks appear in
neither outcome list. Live reporting stays in typed config callbacks:
`onTaskComplete`, `onTaskError`, `onRetry` (replacing the status-string
sniffing), and `onConcurrencyChange`. Permanently failed chunks reach
diagnostics through FailureLog entries (`record(entries)` with an optional
`message` per index, `load()` accepting both the legacy bare-number arrays
and the object form), so `logs/tts_failN.json` and the pool's
`directoryHandle` option are gone.

## Consequences

- One call owns the whole lifecycle: no caller can leak a pool or hang on a
  stage that lost its completion signal — the mid-flight abort resolves
  through the same `CancellationError` catch that routes to
  `ports.run.cancel`.
- The pool cannot be reused or appended to; a new conversion creates a new
  pool, which is what the orchestrator already did.
- Failure diagnostics land in the tenant file that resume actually reads
  ([ADR-0016](0016-chunk-store-owns-work-folder.md)), with messages attached
  to indices instead of scattered side-channel files.
- Bounded-retry behavior, ladder throttling, and offline pause are unchanged
  ([ADR-0013](0013-bounded-retry-tts-socket-pool.md)); only their observation
  points moved (outcome + callbacks).
- `WorkerPoolProgress`, `StatusUpdate`, and the `String(partIndex)`
  completed-map fossil are deleted; the completed set holds numbers.
