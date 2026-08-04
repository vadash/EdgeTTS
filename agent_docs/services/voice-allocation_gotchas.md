# Voice Allocation Gotchas

## 80/20 unique vs shared split

- Each gender pool is split once at construction: the first 80% are unique slots, the remaining 20% is a shared tail.
- A character gets a unique voice only while its gender's unique slice has an unused entry; after that, all further characters of that gender cycle the shared tail.
- Callers sort characters by line count before allocation. The top speakers reach the unique slice first and receive distinct voices; minor speakers share the tail and may repeat.
- The split guarantees a non-empty tail while any voice exists. A naive ceil(0.8 × n) on a 1- or 2-voice pool would put everything in the unique slice, leaving nothing to round-robin.
- Gender routing is strict for declared genders. Unknown-gender characters borrow from whichever gender pool is less used, then cross-borrow if that pool is empty.

## Reroll invariance

- Rerolling a subset of characters is deterministic unless the pool order is shuffled.
- Reservation strips the voices already held by frozen rows (narrator plus rows above the clicked index) from the front of the pool, so unshuffled reroll hands each lower row back the voice it already had — a no-op.
- Shuffle must stay inside a priority tier, so a native voice is never passed over for a multilingual one for the same locale.
