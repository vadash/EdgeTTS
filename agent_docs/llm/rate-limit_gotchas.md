# LLM Rate-Limit Governance

The provider pool is shared by all workers. One 429 means the whole pool is exhausted.

## Contract

A 429 status, or a rate-limit payload at any status, triggers all of these:

- Concurrency drops to 1 immediately, for the worker pool and for single callers.
- All callers park until the provider deadline passes, plus 1 second of margin.
- After the wait, concurrency climbs one slot per clean call, up to the configured ceiling.
- A new 429 collapses concurrency to 1 again.

The gate state is process-global. It is not keyed per provider. A conversion uses one upstream at a time.

## Rules to keep

- Cooldown deadlines only extend. A shorter deadline must never cut an active cooldown short.
- Clamp the provider retry delay to a maximum. Tune the value, but keep a ceiling.
- The cooldown wait must reject on abort, so cancel is immediate.
- Log once per deadline extension, not once per parked worker. This prevents log floods.
- The climb ceiling is the configured thread setting. Never hardcode a cap above it.
- A stage declares its ceiling on entry. A lower declared ceiling lowers the live limit at once.

## Concurrency badge

- The status panel badge must show live gate concurrency, not the configured thread count.
- Push the effective value to the store on every gate change. A one-time seed alone leaves the badge frozen.
