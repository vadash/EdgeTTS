# LLM Pipeline Gotchas

Advanced passes and API-client specifics for `src/services/llm/`.

- **Consensus Merge**: 5 votes with random temperatures (0.1-0.7). Pairs in >=2 votes get merged (Union-Find in `votingConsensus.ts`).
- **QA Pass (Assign)**: `useVoting` enables **adaptive** QA — the QA call only fires when `needsQAPass()` (`qaTrigger.ts`) flags a block as ambiguous: >2 distinct non-narrator speakers, a quote-bearing sentence left to narration, or a sentence mentioning a character other than its assigned speaker. Unambiguous blocks reuse the draft directly (1 call). QA still falls back to the draft if it fails. Setting semantics stay "enable QA"; tuning the rules is a one-line change in the pure `needsQAPass` (covered by `qaTrigger.test.ts`).
- **Frequency Culling**: `cullByFrequency()` filters characters with <3 mentions BEFORE the LLM merge step. Counting uses Unicode word-boundary regex (`BEFORE_NAME`/`AFTER_NAME` lookarounds, `gu` flag, no `i` — callers lowercase `fullText`) so substring matches inside other words do NOT inflate counts (e.g. "Eva" won't match "evaluation"). The constants and `escapeRegExp` mirror `qaTrigger.ts`; variations <3 chars are skipped (pinned by tests). Add any new matching pattern there by copying that pair, NOT by sharing a module (current convention — two call sites).
- **Strict Structured Outputs**: Managed natively by Zod 4's `toJSONSchema({ target: 'draft-7' })`. Schemas in `schemas.ts` are non-strict: extra keys silently ignored, missing keys default to `null`.
- **P-Retry context**: In `p-retry`, callbacks receive `{error, attemptNumber}`, NOT the raw error.
