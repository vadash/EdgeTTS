# LLM Services

API orchestration and strict structured JSON parsing.

## Architecture

- `LLMApiClient.ts`: Raw API caller with custom browser headers. Uses `callStructured<T>()`.
- `schemas.ts`: Zod 4 non-strict schemas (extra keys silently ignored; missing keys default to `null`).
- `votingConsensus.ts`: 5-way Union-Find consensus logic.

## JSON Repair Pipeline (`utils/text.ts`)

`safeParseJSON` applies a 5-tier fallback:
1. Native `JSON.parse`
2. `extractJsonBlocks` + `jsonrepair`
3. Structural recovery (array-at-root wrapping, flattened-assignments)
4. Aggressive scrub (fix LLM `+` concatenation hallucinations)
5. Fatal `RetriableError`

Helper fns: `normalizeText`, `stripThinkingTags`, `stripMarkdownFences`.

## Advanced Pipelines

- **Consensus Merge**: 5 votes with random temperatures (0.1-0.7). Pairs in >=2 votes get merged.
- **QA Pass (Assign)**: If `useVoting` enabled, runs Assign (draft) -> QA (correction). Falls back to draft if QA fails.
- **Frequency Culling**: `cullByFrequency()` filters characters with <3 mentions BEFORE the LLM merge step.

## Gotchas

- **Strict Structured Outputs**: Managed natively by Zod 4's `toJSONSchema({ target: 'draft-7' })`.
- **Errors**: `LLMApiClient` MUST throw `RetriableError` so `withRetry` catches it. Use `getErrorMessage(e)`.
- **P-Retry context**: In `p-retry` 7.x, callbacks receive `{error, attemptNumber}`, NOT the raw error.
