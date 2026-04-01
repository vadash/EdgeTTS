# LLM Service & Prompts

**WHAT**: Orchestrates API calls to OpenAI/Mistral/DeepSeek using robust JSON parsing with repair pipeline.

## Architecture

### Prompt System
Prompts follow a 3-message topology (System/User/Assistant) assembled by `promptFormatters.ts`.
Per-stage files (`role.ts`, `rules.ts`, `schema.ts`, `builder.ts`, `examples/`) and shared utilities (`preambles.ts`, `rules.ts`, `formatters.ts`) are documented in `src/config/prompts/CLAUDE.md`.

## JSON Repair Pipeline

**Location**: `src/utils/text.ts`

`safeParseJSON<T>(input, options)` applies 5-tier waterfall repair:

| Tier | Strategy |
|------|----------|
| 0 | Input validation (null, empty, already object) |
| 1 | Native `JSON.parse` |
| 2 | `extractJsonBlocks` + `jsonrepair` |
| 3 | `normalizeText` + `extractJsonBlocks` + `jsonrepair` |
| 4 | Aggressive `scrubConcatenation` + `jsonrepair` |
| 5 | Failure (return error result) |

Returns `{success, data?, error?}` result object. Caller throws `RetriableError` on failure.

**Key functions:**
- `normalizeText` — Fix smart quotes, control characters
- `extractJsonBlocks` — Extract ALL balanced blocks (not just last)
- `scrubConcatenation` — Fix LLM string `+` hallucinations
- `stripThinkingTags` — Strip `<think>`, `[THINK]`, etc. (regex-based)
- `stripMarkdownFences` — Strip ``` and ~~~ fences

## Clients

- **`LLMApiClient.ts`**: Manages raw API calls with `callStructured<T>({ messages, schema, schemaName })`
- **StructuredCallOptions**: Uses `messages` array (not `prompt` object) since v2

## Schemas

- **`schemas.ts`**: Zod v4 schemas for Extract, Merge, Assign stages with `.strict()` mode enabled
- **`schemaUtils.ts`**: Type utilities and response helpers

All schemas include `reasoning` field (nullable) for chain-of-thought extraction.
**`.strict()` mode** rejects extra keys at root level — future-proofs against LLM hallucinations adding unexpected fields.

## Consensus Voting

### Merge: 5-Way Voting
- `MERGE_VOTE_COUNT` (5) votes with random temperatures (0.0-1.0)
- Union-Find consensus via `buildMergeConsensus()` in `votingConsensus.ts`
- Pairs in >=2 of 5 votes get merged

### Assign: QA Pass (Sequential)
- When `useVoting` is enabled, runs Assign (draft) -> QA (correction) sequentially
- 2 API calls instead of the old 3-way voting
- QA prompt (`src/config/prompts/qa/`) reviews draft for: vocative traps, missed action beats, misassigned narration, missing dialogue
- Falls back to draft results if QA call fails
- Uses same `AssignSchema` for both passes
- **Overlap Context**: Last 5 sentences from previous block passed as `overlapSentences` with negative indices `[-5]` through `[-1]`. Read-only (inside `<previous_context_do_not_assign>` tags).

## Pre-Merge Frequency Culling

Before LLM merge, `cullByFrequency()` filters characters with fewer than 3 total name-variation mentions in the raw text. This removes hallucinated characters and reduces API costs.

## Gotchas & Rules

- **RetriableError REQUIRED**: ALL errors in `LLMApiClient` MUST be `RetriableError`. Plain `Error` breaks `withRetry()`.
- **Safe error logging**: Use `getErrorMessage(e)` from `@/errors`, never `(e as Error).message`
- **p-retry 7.x**: Callbacks receive context object `{error, attemptNumber, retriesLeft}`, NOT error directly. Use `context.error`.
- **Prefill Strategy**: Currently only `none` and `auto` are supported. Both result in no assistant prefill message.
- **Language Mirroring**: Non-English stories must preserve original script in values (JSON keys remain English).
