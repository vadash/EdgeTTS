# LLM pass failure policy: primary to the retry limit, then backup, then degrade

Extract and Assign retry the primary model to the per-stage limit, then fall back to the backup model. An aborted request never falls back to the backup model. Exhaustion of both models degrades instead of aborting: Extract yields no characters for the block (other blocks cover the same character), and Assign gives every sentence in the block the narrator voice. No failure path aborts the conversion.

## Consequences

- The max-retries setting counts attempts after the first (p-retry style). Zero is valid: one call, then the backup model takes over. Extract and Assign permit zero retries in the settings UI.
- On backup fallback, Extract and the Assign draft split the block in two halves and send them separately. The primary model always receives the full block; it is never split. Merging halves concatenates Extract results; Assign re-indexes the second half and shifts its keys.
- A single-line block cannot split; it is replayed whole.
- Merge never falls back to the backup model: one request per temperature, and the max-retries setting sizes the temperature budget rather than a per-attempt retry loop (see [ADR-0008](0008-character-merge-voting.md)).
- With voting on, Assign produces a draft pass and then a QA pass corrects it. A failed QA falls back to the draft: the draft is always usable.
- QA retries the primary model only. It never uses the backup model.

Absorbs the former ADR-0009 (assign draft and QA pass) and ADR-0011 (degrade on exhaustion); their numbers are retired.
