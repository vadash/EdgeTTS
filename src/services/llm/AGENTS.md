# LLM Services

API orchestration and structured JSON parsing.

## Layout

- The API client sends structured completion requests with custom browser headers.
- Zod schemas define the expected response shape. They are non-strict.
- The consensus module merges multiple votes with Union-Find.
- The vote pool fires the configured vote count concurrently at distinct temperatures. One request per temperature — no same-temp retry. Surplus attempts are aborted once the quota fills; a failed attempt is replaced by a fresh temperature.

## Rules

- The API client must throw the retriable error type, or the retry helper ignores the failure.
- The request body has a dedicated type that includes vendor extensions. Cast only at the client call site.
- Never use an untyped cast for the whole request. Add new vendor keys to the request type instead.
- Stage tests stub the injected transport; never mock the OpenAI SDK.

## Decisions

Read the ADR before changing the governed area:

- JSON parsing or repair → `../../../docs/adr/0007-tiered-json-parse-and-repair.md`
- Voting and culling → `../../../docs/adr/0008-character-merge-voting.md`
- Pass failure policy: fallback, degrade, QA → `../../../docs/adr/0010-llm-pass-failure-policy.md`
- Rate-limit handling, concurrency, backoff → `../../../docs/adr/0012-process-global-rate-limit-gate.md`
- Stage tests, transport seam → `../../../docs/adr/0015-llm-stages-closure-factory.md`
