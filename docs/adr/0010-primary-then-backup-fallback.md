# Primary model to the retry limit, then backup

Extract and Assign retry the primary model to the per-stage limit, then fall back to the backup model. An aborted request never falls back to the backup model.

## Consequences

- The max-retries setting counts attempts after the first (p-retry style). Zero is valid: one call, then the backup model takes over. Extract and Assign permit zero retries in the settings UI.
- On backup fallback, Extract and the Assign draft split the block in two halves and send them separately. The primary model always receives the full block; it is never split. Merging halves concatenates Extract results; Assign re-indexes the second half and shifts its keys.
- A single-line block cannot split; it is replayed whole.
- Merge never falls back to the backup model: one request per temperature, and the max-retries setting sizes the temperature budget rather than a per-attempt retry loop.
