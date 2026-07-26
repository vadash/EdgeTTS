# LLM Pipeline Gotchas

Advanced passes and API-client specifics for `src/services/llm/`.

- **Consensus Merge**: 5 votes with random temperatures (0.1-0.7). Pairs in >=2 votes get merged (Union-Find in `votingConsensus.ts`).
- **QA Pass (Assign)**: If `useVoting` enabled, runs Assign (draft) -> QA (correction). Falls back to draft if QA fails.
- **Frequency Culling**: `cullByFrequency()` filters characters with <3 mentions BEFORE the LLM merge step.
- **Strict Structured Outputs**: Managed natively by Zod 4's `toJSONSchema({ target: 'draft-7' })`. Schemas in `schemas.ts` are non-strict: extra keys silently ignored, missing keys default to `null`.
- **P-Retry context**: In `p-retry`, callbacks receive `{error, attemptNumber}`, NOT the raw error.
