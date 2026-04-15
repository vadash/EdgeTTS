# Prompts Module

LLM prompt construction for character extraction, merge, and speaker assignment.
Adapted from OpenVault's battle-tested pattern for mid-tier CN instruct models (Qwen, Kimi).

## Architecture

Three extraction stages + shared utilities. Each stage follows a fixed file convention:

```text
src/config/prompts/
  shared/       # Preambles, rule constants, and message formatters
  extract/      # Stage 1: Character extraction
  merge/        # Stage 2: Character deduplication
  assign/       # Stage 3: Speaker attribution
  qa/           # Stage 4: Review & correct Assign output (if useVoting enabled)
```

**Per-Stage Files:**
- `role.ts`: System role definition (who the model is)
- `rules.ts`: Task-specific constraints + in-JSON `reasoning` field reasoning steps
- `schema.ts`: Output JSON schema description
- `builder.ts`: Assembles messages via `buildMessages()`
- `examples/{lang}.ts`: Few-shot examples with `output` property (JSON with embedded reasoning)
- `examples/index.ts`: `getExamples(language)` — returns filtered examples

## Prompt Topology

We use a 3-message topology:
1. **System**: Preamble + Role + Examples (via `assembleSystemPrompt`)
2. **User**: Content + Constraints (language rules + task rules + schema + execution trigger)
3. **Assistant**: Prefill (biases model into correct track; currently defaults to `none`)

## Code Style

- **Few-Shot Examples**: Each example object has: `{ input, output, label? }`. The `reasoning` is inside the JSON output.
- **Language Mirroring**: Non-English stories must preserve original script in values (JSON keys remain English). `MIRROR_LANGUAGE_RULES` handles this.
- **CoD Shorthand Convention**: All LLM prompts use Chain-of-Draft (CoD) reasoning — terse drafts with max 5 words per step. Shorthand notation: paragraph numbers (N:), speaker codes, arrow notation (→), "voc" for vocatives, "narr" for narration, "sys" for system entities. The `EXECUTION_TRIGGER` in `shared/rules.ts` enforces this globally.

## Gotchas

- **Recency Bias Defeat**: Schema and rules are placed in the **user** prompt (end of context window) to defeat recency bias.
- **Prompt Repetition**: When `REPEAT_PROMPT` is true, the User message is duplicated (`<QUERY><QUERY>`) for improved bidirectional attention during prefill.
- **Overlap Context**: In the Assign and QA stages, the last 10 sentences from the previous block are passed as `overlapSentences` with negative indices (`[-10]`). These are read-only and must NOT be assigned.
- **QA Stage**: Reuses Assign's schema (`ASSIGN_SCHEMA_TEXT`). Builder injects draft assignments as a `<draft_assignments>` block.