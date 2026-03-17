# LLM Service & Prompts

**WHAT**: Orchestrates API calls to OpenAI/Mistral/DeepSeek using robust JSON parsing with repair pipeline.

## Architecture

### 3-Message Prompt Topology
We use a 3-message structure to defeat recency bias and improve compliance:
1. **System**: Preamble + Role + Examples (`src/config/prompts/shared.ts`)
2. **User**: Content + Constraints (language rules + task rules + schema + execution trigger)
3. **Assistant**: Prefill (biases model into correct reasoning track)

See `promptFormatters.ts` for message assembly functions.

### Prompt Structure
Prompts in `src/config/prompts/` are split into components:
- **`role`**: Task description and identity
- **`examples`**: Input/output examples
- **`rules`**: Task-specific constraints
- **`schemaText`**: JSON schema example
- **`userTemplate`**: Template with `{{placeholders}}`

Stages: `extract.ts` → `merge.ts` → `assign.ts`

### Shared Prompt Constants (`src/config/prompts/shared.ts`)
- **`SYSTEM_PREAMBLE_CN`**: Frames task as production pipeline with pre-authorization
- **`MIRROR_LANGUAGE_RULES`**: Ensures output values match source text language
- **`EXECUTION_TRIGGER`**: Final instruction defeating recency bias
- **`PREFILL_PRESETS`**: Assistant prefills (`cn_compliance`, `pure_think`, `json_only`, etc.)

## JSON Repair Pipeline

**Location**: `src/utils/text.ts`

`safeParseJSON<T>(input, schema)` applies multi-stage repair:
1. Strip thinking/reasoning tags (`<think>`, `[THINK]`, `*thinks*`, etc.)
2. Strip markdown code fences
3. Extract last balanced JSON block (dodges `<tool_call>` hallucinations)
4. Sanitize LLM syntax hallucinations (string concatenation `+`, dangling plus)
5. Pad truncated outputs (odd quote count detection)
6. `jsonrepair` library for structural fixes
7. Zod schema validation

Used by `LLMApiClient.callStructured()` instead of native parsing.

## Clients

- **`LLMApiClient.ts`**: Manages raw API calls with `callStructured<T>({ messages, schema, schemaName })`
- **StructuredCallOptions**: Uses `messages` array (not `prompt` object) since v2

## Schemas

- **`schemas.ts`**: Zod v4 schemas for Extract, Merge, Assign stages
- **`schemaUtils.ts`**: Type utilities and response helpers

All schemas include `reasoning` field (nullable) for chain-of-thought extraction.

## Consensus Voting

- **Merge**: `MERGE_VOTE_COUNT` (5-way) Union-Find consensus with random temperatures
- **Assign**: `ASSIGN_VOTE_COUNT` (3-way) majority vote with fixed temperatures [0.3, 0.7, 1.0]

## Gotchas & Rules

- **RetriableError REQUIRED**: ALL errors in `LLMApiClient` MUST be `RetriableError`. Plain `Error` breaks `withRetry()`.
- **Safe error logging**: Use `getErrorMessage(e)` from `@/errors`, never `(e as Error).message`
- **p-retry 7.x**: Callbacks receive context object `{error, attemptNumber, retriesLeft}`, NOT error directly. Use `context.error`.
- **Prefill Strategy**: `pure_think` is safest default. Use `cn_compliance` for Kimi/Qwen.
- **Language Mirroring**: Non-English stories must preserve original script in values (JSON keys remain English).
