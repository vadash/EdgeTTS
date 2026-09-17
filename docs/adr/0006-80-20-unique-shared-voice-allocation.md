# 80/20 unique-vs-shared voice allocation

Each gender pool splits once at construction: the first 80% are unique slots, the remaining 20% is a shared tail. Callers sort characters by line count before allocation, so the top speakers reach the unique slice first and get distinct voices while minor speakers cycle the shared tail and may repeat.

## Consequences

- The split guarantees a non-empty tail while any voice exists. A naive ceil(0.8 × n) on a 1- or 2-voice pool would put everything in the unique slice, leaving nothing to round-robin.
- Gender routing is strict for declared genders. Unknown-gender characters borrow from whichever gender pool is less used, then cross-borrow if that pool is empty.
- Rerolling a subset of characters is deterministic unless the pool order is shuffled. Reservation strips the voices already held by frozen rows (narrator plus rows above the clicked index) from the front of the pool, so an unshuffled reroll hands each lower row back the voice it already had — a no-op.
- Shuffle must stay inside a priority tier, so a native voice is never passed over for a multilingual one for the same locale.

## Addendum (2026-09-17, architecture follow-up)

The frequency sort moved inside the single allocation entry `allocateVoices` (absent frequency = input order); `topSpeakerPoolPercent` config key deleted — the split is fixed at `UNIQUE_POOL_RATIO` 0.8, one source for allocation and the run log. Semantics unchanged.
