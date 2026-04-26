# Prompts Module

Chain-of-Draft (CoD) extraction prompts optimized for mid-tier instruct models.

## Architecture

Pipeline: `extract/` -> `merge/` -> `assign/` -> `qa/`
Files per stage: `role.ts`, `rules.ts`, `schema.ts`, `builder.ts`, `examples/`

## Message Topology

1. **System**: Preamble + Role + Examples (`assembleSystemPrompt`)
2. **User**: Content + Constraints (language, task rules, schema, trigger)
3. **Assistant**: Prefill (currently defaults to `none`)

## Gotchas

- **Recency Bias**: Schema and rules MUST be placed in the User prompt.
- **Language Mirroring**: `MIRROR_LANGUAGE_RULES` ensures output values match the source text language (keys stay English).
- **CoD Shorthand**: JSON `reasoning` field must use terse drafts (max 5 words/step, e.g., "N: code", "→", "voc", "sys").
- **Prompt Repetition**: If `REPEAT_PROMPT=true`, User message is duplicated (`<QUERY><QUERY>`) for bidirectional attention.
- **Overlap Context**: Assign/QA stages receive the last 10 sentences as negative indices (`[-10]`). These are read-only; do NOT assign.
