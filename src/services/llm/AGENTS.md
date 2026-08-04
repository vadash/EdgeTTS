# LLM Services

API orchestration and structured JSON parsing.

## Layout

- The API client sends structured completion requests with custom browser headers.
- Zod schemas define the expected response shape. They are non-strict.
- The consensus module merges multiple votes with Union-Find.
- The vote pool fires the configured vote count concurrently at distinct temperatures. A failed vote is replaced by a fresh temperature, not retried at the same value.

## Rules

- The API client must throw the retriable error type, or the retry helper ignores the failure.
- The request body has a dedicated type that includes vendor extensions. Cast only at the client call site.
- Never use an untyped cast for the whole request. Add new vendor keys to the request type instead.

## Detailed Gotchas

- Changing JSON parsing or repair → read `../../../agent_docs/llm/json-repair_gotchas.md`.
- Changing voting, QA pass, culling, or model fallback → read `../../../agent_docs/llm/pipelines_gotchas.md`.
- Changing rate-limit handling, concurrency, or backoff → read `../../../agent_docs/llm/rate-limit_gotchas.md`.
