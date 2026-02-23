# LLM Service & Prompts

**WHAT**: Orchestrates API calls to OpenAI/Mistral/DeepSeek using Structured Outputs.

## Architecture
- **Prompts**: Located in `src/config/prompts/`. We use strict XML tags (`<instructions>`, `<rules>`, etc.) to guide the LLM.
- **Clients**: `LLMApiClient.ts` manages the raw API calls. It strips standard SDK headers to bypass certain proxies.
- **Schemas**: `schemas.ts` defines Zod v4 schemas for each LLM stage (Extract, Merge, Assign).
- **Schema Utils**: `schemaUtils.ts` converts Zod schemas to OpenAI-compatible JSON Schema using native `z.toJSONSchema()`.

## Structured Outputs (NEW)
We use OpenAI's Structured Outputs feature with `strict: true` for all LLM calls:
- **Extract**: Returns `{reasoning, characters[]}` with guaranteed structure
- **Merge**: Returns `{reasoning, merges[][]}` - array of index groups to merge
- **Assign**: Returns `{reasoning, assignments{}}` - sparse object mapping sentence indices to character codes

### Key Implementation Details
- **Zod v4**: Uses `.nullable()` not `.optional()` for OpenAI strict mode compatibility
- **Transform**: Null reasoning fields are transformed to `undefined` for clean types
- **Refusal Handling**: `callStructured()` throws on LLM refusals (content policy violations)
- **Draft-7 Target**: JSON Schema uses `target: 'draft-7'` for OpenAI compatibility

## Consensus Voting
We use a multi-vote system to improve accuracy:
- **Merge**: 5-way Union-Find consensus with random temperatures
- **Assign**: 3-way majority vote with fixed temperatures [0.3, 0.7, 1.0]

## Gotchas & Rules
- **Streaming**: Structured outputs support streaming when enabled via `streaming: true` in client options
- **Sparse Assign Format**: Assign uses `{"0": "A", "5": "B"}` not line-by-line format
- **Record Syntax**: Zod 4 requires 2-arg `z.record(keySchema, valueSchema)`
- **No JSON Repair**: Structured outputs guarantee valid JSON - no repair logic needed
