# Character merge voting

Character merge runs the configured vote count concurrently, each vote at a distinct temperature — one request per temperature, no same-temp retry. Pairs seen in 2 or more of the gathered votes merge by Union-Find.

## Consequences

- The temperature budget is vote count × (1 + max retries), capped at 60. A failed attempt is replaced by a fresh unused temperature.
- Once the vote quota fills, still-running attempts are aborted, so a timed-out loser stops burning wall clock and provider quota.
- Fewer than 2 surviving votes return the original characters: consensus needs 2 votes per pair, so a single vote cannot merge anything.
- Characters with fewer than 3 mentions are culled before the merge step. Mention counting uses word boundaries (a name inside a longer word does not count) and is case-sensitive, so callers lowercase the text first. Name variations shorter than 3 characters are skipped.
