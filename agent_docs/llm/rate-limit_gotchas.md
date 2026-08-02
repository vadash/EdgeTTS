# LLM Rate-Limit / Concurrency Governance

The LLM provider's upstream pool is shared across all parallel workers in a conversion. A single 429 means the **whole pool** is exhausted — retrying in parallel with exponential backoff only deepens the throttle and floods the log with identical circuit-open errors from every parked worker.

## The contract

On any 429 (or `rate_limit_error` payload, even at a non-429 status from the sidecar):

1. **Concurrency collapses to 1 immediately** — both the conversion-wide worker pool and any single-`withRetry` caller drain to one in-flight request.
2. **Every caller parks** until the provider's own deadline elapses, **plus a 1s safety margin** so no worker probes one tick early and re-trips the circuit.
3. **Resume single-file, then climb one slot per clean call**, stopping at the configured ceiling (the user's LLM thread setting, declared per stage). One fresh 429 collapses to 1 again.

This is a process-global state, intentionally **not keyed per provider**. A conversion talks to a single upstream at a time; add per-pool keying only if multi-provider fan-out ever lands.

## What must be preserved when editing this area

- **The cooldown deadline is monotonic.** Overlapping 429s from a fan-out must converge on the *longest* deadline, never race it down. A second `trip` with a shorter retry-after must not shorten an active cooldown.
- **Coercion ceiling.** A hostile/buggy `Retry-After` is clamped (currently 10 min) so a single bad header can't wedge the app indefinitely. Keep a ceiling; tune the value, don't remove it.
- **The wait is abort-aware.** A user cancelling a conversion mid-cooldown must not wait minutes. The gate's wait rejects on `AbortSignal`.
- **One log line per deadline extension, not per parked worker.** The dedup is what stops the log flood this gate exists to prevent — don't move logging to the wait path.
- **The climb ceiling is the configured LLM thread setting, not a hardcoded cap.** A stage declares its ceiling up front so the gate stops at the actual configured value. A hardcoded 32 above the user's 15 used to let the gate climb into headroom the queue was already clamping away — burning success streaks on slots that could never run and logging a misleading "raised to 19". Declaring a lower ceiling than the current live limit snaps the limit straight down.

## Live badge wiring

The status-panel `⚡ LLM: N` badge MUST reflect the gate's live effective concurrency (the min of the configured ceiling and the gate's current limit), not the configured thread count captured once. Whenever the gate reduces or recovers, the effective value must propagate to the store that drives the badge; a frozen badge at the ceiling even after a 429 collapses the gate is the canonical bug here. A one-shot prime at stage entry is fine, but only as a seed before the first LLM call — never as the sole update.
