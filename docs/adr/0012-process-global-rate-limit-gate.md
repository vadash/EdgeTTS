# Process-global rate-limit gate

The provider pool is shared by all workers, and a conversion uses one upstream at a time, so the rate-limit gate is process-global rather than keyed per provider. A 429 — or a rate-limit payload at any status — collapses concurrency to 1 immediately (worker pool and single callers alike), parks all callers until the provider deadline passes plus 1 second of margin, then climbs one slot per clean call up to the configured ceiling. A new 429 collapses concurrency to 1 again.

## Consequences

- A network-down failure (failed fetch, refused connection, gateway 502/503/504) also trips the gate, for the default one-minute cooldown. The first attempt after a network-down cooldown is the recovery probe; a failure re-trips for another minute. Request timeouts and data-quality errors do not trip the gate.
- Cooldown deadlines only extend: a shorter deadline must never cut an active cooldown short.
- The provider retry delay is clamped to a maximum; tune the value, keep a ceiling.
- The cooldown wait must reject on abort, so cancel is immediate.
- Log once per deadline extension, not once per parked worker, to prevent log floods.
- The climb ceiling is the configured thread setting; never hardcode a cap above it. A stage declares its ceiling on entry, and a lower declared ceiling lowers the live limit at once.
- The status panel badge shows live gate concurrency, not the configured thread count. Push the effective value to the store on every gate change; a one-time seed alone leaves the badge frozen.
- Provider errors arrive at the gate pre-tagged: `LLMApiClient` classifies each caught error via `classifyProviderError` (HTTP status, then retry-after headers, then provider prose as a last resort, preserving the sidecar's `retry-after-ms` deadline) and attaches the tag to the thrown `RetriableError`. The gate reads those tags only and never inspects messages; the gate-side regex battery and cause-chain walks are deleted (amended 2026-09-17).

