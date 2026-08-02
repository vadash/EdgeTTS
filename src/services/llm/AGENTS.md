# LLM Services

API orchestration and strict structured JSON parsing.

## Architecture

- `LLMApiClient.ts`: Raw API caller with custom browser headers. Uses `callStructured<T>()`.
- `schemas.ts`: Zod 4 non-strict schemas.
- `votingConsensus.ts`: 5-way Union-Find consensus logic.

## Gotchas

- **Errors**: `LLMApiClient` MUST throw `RetriableError` so `withRetry` catches it.
- **No `as any`**: `callStructured` builds the request as `StructuredRequestBody` (an `Omit<ChatCompletionCreateParamsNonStreaming,'stream'>` plus vendor extensions `enable_thinking`/`reasoning_effort`) and casts only at the two `chat.completions.create` call sites via `as unknown as ChatCompletionCreateParams(Non)Streaming`. Do NOT reintroduce `as any` — the biome override for this file was deliberately removed; `noExplicitAny` must stay clean. If a new vendor key is needed, add it to `StructuredRequestBody` rather than casting the whole object.

## Detailed Gotchas

- Changing JSON parsing/repair (`safeParseJSON`) → read `agent_docs/llm/json-repair_gotchas.md`
- Changing voting, QA pass, culling, backup model fallback, or per-stage retry → read `agent_docs/llm/pipelines_gotchas.md`
- Changing 429 / rate-limit handling, worker concurrency, or retry backoff → read `agent_docs/llm/rate-limit_gotchas.md`
