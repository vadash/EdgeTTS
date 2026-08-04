# LLM Pipeline Gotchas

Advanced passes and client behavior for the LLM services.

## Voting and passes

- Each merge vote runs at a distinct temperature, one request per temperature — no same-temp retry. The temperature budget is vote count × (1 + max retries), capped at 60. A failed attempt is replaced by a fresh unused temperature.
- Once the vote quota fills, still-running attempts are aborted so a timed-out loser stops burning wall clock and provider quota.
- Pairs seen in 2 or more of the gathered votes merge by Union-Find.
- With voting on, Assign runs a draft pass then a QA correction pass. A failed QA falls back to the draft.
- QA retries the primary model only. It never uses the backup model.

## Character culling

- Characters with fewer than 3 mentions are removed before the LLM merge step.
- Mention counting uses word boundaries, so a name inside a longer word does not add to the count.
- Counting is case-sensitive. Callers must lowercase the text first.
- Name variations shorter than 3 characters are skipped.

## Schemas

- Structured output schemas are generated from Zod to draft-7 JSON Schema.
- Schemas are non-strict. Extra keys are ignored and missing keys become null.
- Retry callbacks receive an object with the error and attempt number, not the raw error.

## Retry and fallback

- Extract and Assign retry the primary model to the per-stage limit, then fall back to the backup model.
- An aborted request never falls back to the backup model.
- On backup fallback, Extract and the Assign draft split the block in two halves and send them separately.
- The primary model always receives the full block. It is never split.
- Merging halves concatenates Extract results. Assign re-indexes the second half and shifts its keys.

- A single-line block cannot split. It is replayed whole.
- Merge never falls back to the backup model. One request per temperature; the max-retries setting sizes the temperature budget, not a per-attempt retry loop.
- Fewer than 2 surviving votes return the original characters — consensus needs 2 votes per pair, so a single vote cannot merge anything.

## Reasoning models

- When reasoning is off, the client sends the template kwarg and an inline marker to suppress thinking. Thinking-by-default models that reason through the whole budget never emit JSON otherwise.
- The streaming path reads reasoning on a separate buffer. When the payload arrives in reasoning and content is empty, the parser falls back to reasoning rather than rejecting the response.

## Degrade on exhaustion

- If Extract exhausts both models, the block yields no characters. Other blocks cover the same character.
- If Assign exhausts both models, every sentence in the block uses the narrator voice.
- Neither case aborts the conversion.
