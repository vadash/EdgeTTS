# ADR-0017: One cancellation encoding

Date: 2026-09-17
Status: Accepted

## Context

Cancellation reached the orchestrator's catch block through four different encodings: `new Error('Pipeline cancelled')` from the stage pre-checks and the TTS pre-abort reject, `new Error('Operation cancelled')` from `collectVotes`, `runWithConcurrency`, and `rateLimitGate`, `new Error('Voice review cancelled')` from the review gate, and p-retry's `AbortError` class (plus the DOMException p-retry rejects with when the signal fires during backoff). The typed branch in the catch — `error instanceof AppError && error.isCancellation()` — had zero producers: no code ever threw `AppError('CONVERSION_CANCELLED')`. A mid-flight cancel therefore fell through to the string-equality fallback, and any producer whose message didn't match the two magic strings recorded a user cancellation as a run failure.

## Decision

`CancellationError` (extends `AppError`, code `CONVERSION_CANCELLED`) is the one encoding for a user cancellation, and `throwIfAborted(signal)` is the standard pre-check. Every producer throws it: the orchestrator's `checkCancelled` and TTS pre-abort reject, `collectVotes`, `runWithConcurrency`, `rateLimitGate` (`waitTurn` pre-check and the cooldown-sleep abort listener), and the review gate's decline (`reviewGate.decline` — named `cancelReview` when this ADR landed, renamed by ADR-0019). The one translation point is `withRetry`: when p-retry rejects with anything else while the signal has aborted (the abort-during-backoff window), it throws `CancellationError`. The orchestrator's string-equality catch branch is deleted — the type-only branch is the only path.

## Consequences

- The catch branch is type-only (`isCancellation`), so a new cancellation producer cannot silently degrade into a recorded failure by picking the wrong message string.
- Abort during retry backoff is translated once, inside `withRetry`; callers never see p-retry's abort reason.
- Closes the "one Gate + one cancellation encoding" debt named in [ADR-0014](0014-ports-not-stores-in-pipeline.md) on the cancellation half; the review-gate half closed with [ADR-0019](0019-gate-factory-replaces-promise-protocols.md).
- The dead TTS abort-listener wiring in `runTTSStage`, still present when this ADR landed, is gone: [ADR-0018](0018-one-shot-tts-pool-protocol.md) replaced the pool lifecycle and left no listener to wire.
