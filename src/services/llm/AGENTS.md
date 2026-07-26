# LLM Services

API orchestration and strict structured JSON parsing.

## Architecture

- `LLMApiClient.ts`: Raw API caller with custom browser headers. Uses `callStructured<T>()`.
- `schemas.ts`: Zod 4 non-strict schemas.
- `votingConsensus.ts`: 5-way Union-Find consensus logic.

## Gotchas

- **Errors**: `LLMApiClient` MUST throw `RetriableError` so `withRetry` catches it.

## Detailed Gotchas

- Changing JSON parsing/repair (`safeParseJSON`) → read `agent_docs/llm/json-repair_gotchas.md`
- Changing voting, QA pass, or culling → read `agent_docs/llm/pipelines_gotchas.md`
