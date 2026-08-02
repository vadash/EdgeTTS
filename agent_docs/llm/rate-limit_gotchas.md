# LLM Rate-Limit / Concurrency Governance

The LLM provider's upstream pool is shared across all parallel workers in a conversion. A single 429 means the **whole pool** is exhausted — retrying in parallel with exponential backoff only deepens the throttle and floods the log with identical circuit-open errors from every parked worker.

## The contract

On any 429 (or `rate_limit_error` payload, even at a non-429 status from the sidecar):

1. **Concurrency collapses to 1 immediately** — both the conversion-wide worker pool and any single-`withRetry` caller drain to one in-flight request.
2. **Every caller parks** until the provider's own deadline elapses, **plus a 1s safety margin** so no worker probes one tick early and re-trips the circuit.
3. **Resume single-file, then AIMD-climb**: one extra slot opens per streak of clean calls, back toward the configured ceiling. One fresh 429 collapses to 1 again.

This is a process-global state, intentionally **not keyed per provider**. A conversion talks to a single upstream at a time; add per-pool keying only if multi-provider fan-out ever lands.

## What must be preserved when editing this area

- **The cooldown deadline is monotonic.** Overlapping 429s from a fan-out must converge on the *longest* deadline, never race it down. A second `trip` with a shorter retry-after must not shorten an active cooldown.
- **Coercion ceiling.** A hostile/buggy `Retry-After` is clamped (currently 10 min) so a single bad header can't wedge the app indefinitely. Keep a ceiling; tune the value, don't remove it.
- **The wait is abort-aware.** A user cancelling a conversion mid-cooldown must not wait minutes. The gate's wait rejects on `AbortSignal`.
- **One log line per deadline extension, not per parked worker.** The dedup is what stops the log flood this gate exists to prevent — don't move logging to the wait path.
- **p-retry's own backoff is zeroed while a cooldown is active.** The gate inside the operation is the sole timing authority; p-retry's exponential timers (capped far below a typical 2-min cooldown) would otherwise fire mid-cooldown and either re-hammer or stack a pointless extra delay on top. Outside a cooldown, p-retry's original backoff is unchanged.

## Detection surface

A 429 can arrive as: a real HTTP 429 status, a `type: rate_limit_error` body (sidecar may emit this at any status), or — because the API client wraps every failure into one generic retryable error — the literal text `429` / `rate_limit` / `retry-after-ms=NNN` embedded in the wrapped message. Detection and deadline parsing must walk the error **and its cause chain**, and fall back to the message regex when the structured fields are gone.

When the provider sends no parseable deadline, a fixed default cooldown is used.
