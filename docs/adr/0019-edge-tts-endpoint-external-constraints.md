# Edge TTS endpoint external constraints (Microsoft, 2026-10)

## Context

Probing on 2026-10-20 (raw TLS upgrades, upstream edge-tts 7.3.1 cross-checks, real book data from `_temp_work`) established two server-side behaviors introduced around 2026-10-10:

1. **Edg UA floor.** The WebSocket upgrade is refused (HTTP 403) unless the `User-Agent` carries an `Edg/<version>` token of roughly Edge 143 or newer (`Edg/130` → 403, `Edg/143` → 101). Browsers cannot set `User-Agent` on WebSocket, so the app can only connect from a current Microsoft Edge. Chrome and Firefox get a hard 403 at connect, which surfaces in the browser as close code 1006.
2. **Cold-synthesis aborts.** Synthesizing a `text`+`voice` pair the service has never completed intermittently aborts mid-stream: the server sends `turn.start` (and a `response` frame), then closes with 1006/1007 and zero audio; no `turn.end`. Warm requests (pair already synthesized once) are stable and byte-identical across repeats, so the service caches per pair. Failure rate observed on brand-new texts: ~40-60% of first attempts; some pairs keep failing across several attempts, then succeed. Not load-related (60/60 at 50 threads on warm texts), not content-related (plain sentences fail; novel texts pass), not connection-related (fails on fresh and reused sockets alike).

## Decision

- Keep the bounded retry budget as the only mitigation for cold-synthesis aborts (ADR-0013). Retries on a fresh socket succeed once the pair completes somewhere; the budget absorbs the flakiness.
- Surface the WebSocket close code and reason in retry/permanent-failure messages so the failure class is visible in logs instead of a generic message.
- No proxy, no offline fallback, no ladder change: the ladder floor (5) already equals typical manual concurrency, and the aborts are not load-driven.

## Consequences

- Converting a new Book costs extra attempts and backoff time per chunk; resume caches absorb it across sessions.
- The app effectively requires a current Edge browser; other browsers fail at connect with close code 1006 and no further detail (HTTP status is invisible to browser WebSocket).
- If Microsoft tightens the version floor past the user's Edge, conversions fail wholesale with close 1006; first diagnostic is the raw-upgrade probe against the current Edge UA.
