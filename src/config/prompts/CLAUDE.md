# Prompts Module

LLM prompt construction for character extraction, merge, and speaker assignment.
Adapted from OpenVault's battle-tested pattern for mid-tier CN instruct models (Qwen, Kimi).

## Domain Structure

Three extraction stages + shared utilities. Each stage follows a fixed file convention:

| File | Purpose |
|------|---------|
| `role.ts` | System role definition (who the model is) |
| `rules.ts` | Task-specific rules with `reasoning` reasoning steps |
| `schema.ts` | Output JSON schema description |
| `builder.ts` | Assembles messages via `buildMessages()` |
| `examples/{en}.ts` | Few-shot examples with `output` property (JSON with embedded reasoning) |
| `examples/index.ts` | `getExamples(language)` — returns examples for the stage |

Stages: `extract/` (Stage 1), `merge/` (Stage 2), `assign/` (Stage 3), `qa/` (Stage 4 — review & correct Assign output).

### QA Stage (`qa/`)
- Reuses Assign's schema (`ASSIGN_SCHEMA_TEXT`)
- Builder injects draft assignments as `<draft_assignments>` XML block
- Examples show flawed drafts being corrected (vocative traps, action beats, narration)
- Called only when `useVoting` is enabled in `LLMVoiceService`

## Prompt Topology

System prompt = role + examples (via `assembleSystemPrompt`).
User prompt = context + constraints (via `assembleUserConstraints`).
Schema and rules are in the **user** prompt (end of context window) to defeat recency bias.

## Shared Utilities (`shared/`)

- `formatters.ts` — `assembleSystemPrompt`, `assembleUserConstraints`, `buildMessages`, `formatExamples`
- `preambles.ts` — Anti-refusal preambles (CN), `PREFILL_PRESETS`, resolve helpers
- `rules.ts` — `MIRROR_LANGUAGE_RULES`, `EXECUTION_TRIGGER`

## Few-Shot Examples

Each example object has: `{ input, output, label? }`.
- `label`: Language tag like `(EN/Simple)` — used for filtering when language-specific sets are added
- Currently EN only. Add `cn.ts` and update `examples/index.ts` to support more languages.
