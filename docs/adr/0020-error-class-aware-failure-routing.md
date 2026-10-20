# Error-class-aware failure routing

LLM pass failures are classified, and the class picks the recovery path; the retry ladder is no longer uniform. Transport-retriable failures (timeouts, 5xx, mid-stream closes, degenerate output) keep the existing path: Primary model to the retry limit, then Backup model. A parse failure skips the remaining Primary retries and goes directly to the Backup split, because resending the identical request mostly reproduces a near-deterministic failure — one model streamed ~100K characters of duplicated chain-of-thought 18 times in a row. A provider rejecting the request schema itself is deterministic and consumes no retry at the failing level. Auth failures (401, 403) abort the Merge vote pool after two auth-class failures — only a success resets the count, so timeouts interleaved between 403s cannot stall the latch — instead of buying replacement temperatures an outage cannot use.

## Consequences

- Degenerate output — accumulated stream content beyond `maxTokens × 6` chars (named constant), counted across the content and reasoning channels — counts as transport-retriable; the client aborts it mid-stream, and a post-hoc length check guards non-streaming Merge votes.
- Degenerate output is not rate-limit or network-down: the Rate-limit gate never sees it.
- Extract and Assign keep the ladder for auth failures: a 403 on the Primary model says nothing about the Backup route. Only the vote pool fails fast.
- QA keeps its own policy — Primary only, draft stands on failure — and the Primary-never-split invariant stands (see [ADR-0010](0010-llm-pass-failure-policy.md), which this amends).
