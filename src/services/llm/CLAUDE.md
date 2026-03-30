# LLM Service & Prompts

**WHAT**: Orchestrates API calls to OpenAI/Mistral/DeepSeek using robust JSON parsing with repair pipeline.

## Architecture

### 3-Message Prompt Topology
We use a 3-message structure to defeat recency bias and improve compliance:
1. **System**: Preamble + Role + Examples (`src/config/prompts/shared.ts`)
2. **User**: Content + Constraints (language rules + task rules + schema + execution trigger)
3. **Assistant**: Prefill (biases model into correct reasoning track)

**Prefill Behavior**: `PREFILL_PRESETS` currently only supports `none` and `auto` (which resolves to `none`). The compliance presets (`cn_compliance`, `en_compliance`) were removed as they are no longer needed with the simplified 3-message topology.

See `promptFormatters.ts` for message assembly functions.

### Prompt Structure
Prompts in `src/config/prompts/` are split into per-concern files:
- **`role.ts`**: Task description and identity
- **`rules.ts`**: Task-specific constraints + in-JSON `reasoning` field reasoning steps
- **`schema.ts`**: JSON schema example
- **`builder.ts`**: Assembles full message array, moved from PromptStrategy.ts
- **`examples/en.ts`**: Structured `{ input, output, label? }` few-shot examples (reasoning is inside the JSON output)
- **`examples/index.ts`**: `getExamples(language)` — returns filtered examples

Stages: `extract/` → `merge/` → `assign/`

See `src/config/prompts/CLAUDE.md` for the full prompt module documentation.

### Shared Prompt Utilities (`src/config/prompts/shared/`)
- **`preambles.ts`**: `SYSTEM_PREAMBLE_CN` (anti-refusal framing), `PREFILL_PRESETS` (assistant prefills including `'auto'` for language-aware selection)
- **`rules.ts`**: `MIRROR_LANGUAGE_RULES` (output language mirroring), `EXECUTION_TRIGGER` (defeats recency bias)
- **`formatters.ts`**: `assembleSystemPrompt`, `assembleUserConstraints`, `buildMessages`, `formatExamples`

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

- **Merge**: `MERGE_VOTE_COUNT` (5-way) Union-Find consensus with random temperatures
- **Assign**: `ASSIGN_VOTE_COUNT` (3-way) majority vote with fixed temperatures [0.3, 0.7, 1.0]

## Gotchas & Rules

- **RetriableError REQUIRED**: ALL errors in `LLMApiClient` MUST be `RetriableError`. Plain `Error` breaks `withRetry()`.
- **Safe error logging**: Use `getErrorMessage(e)` from `@/errors`, never `(e as Error).message`
- **p-retry 7.x**: Callbacks receive context object `{error, attemptNumber, retriesLeft}`, NOT error directly. Use `context.error`.
- **Prefill Strategy**: Currently only `none` and `auto` are supported. Both result in no assistant prefill message.
- **Language Mirroring**: Non-English stories must preserve original script in values (JSON keys remain English).
