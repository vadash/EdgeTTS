# Prompt Restructure — OpenVault-Style Architecture

**Date**: 2026-03-30
**Status**: Approved

## Goal

Restructure the EdgeTTS prompt system from monolithic per-stage objects into the file-per-concern pattern used in OpenVault. Add structured examples with thinking chains and `<thinking_process>` reasoning instructions.

## Motivation

Current prompt files (`extract.ts`, `merge.ts`, `assign.ts`) pack everything into a single object: role, rules, schema, examples (as raw string), and user template. This makes examples hard to maintain, doesn't support language filtering, and lacks chain-of-thought reasoning guidance.

OpenVault's battle-tested pattern solves all of these:
- **Structured example objects** — `{ input, thinking?, output, label? }` with `formatExamples()` utility
- **Per-concern files** — role, rules, schema, builder, examples are separate
- **`<thinking_process>` blocks** — explicit step-by-step reasoning instructions in rules
- **Language filtering** — `getExamples(language)` returns subset by label
- **Per-domain builders** — assembly logic lives with the domain, not in a central strategy file

## Scope

Pure refactor. No functional changes to runtime behavior. The 3-message topology, preamble/prefill system, Zod schemas, and PromptStrategy all remain — they just get reorganized.

## Target File Structure

```
src/config/prompts/
├── shared/
│   ├── preambles.ts        ← SYSTEM_PREAMBLE_CN, PREFILL_PRESETS, resolve helpers
│   ├── formatters.ts       ← assembleSystemPrompt, assembleUserConstraints, buildMessages, formatExamples
│   └── rules.ts            ← MIRROR_LANGUAGE_RULES, EXECUTION_TRIGGER
├── extract/
│   ├── role.ts             ← EXTRACT_ROLE
│   ├── rules.ts            ← EXTRACT_RULES with <thinking_process>
│   ├── schema.ts           ← EXTRACT_SCHEMA_TEXT
│   ├── builder.ts          ← buildExtractPrompt()
│   └── examples/
│       ├── en.ts           ← 4 examples with thinking chains
│       └── index.ts        ← getExamples(language)
├── merge/
│   ├── role.ts             ← MERGE_ROLE
│   ├── rules.ts            ← MERGE_RULES with <thinking_process>
│   ├── schema.ts           ← MERGE_SCHEMA_TEXT
│   ├── builder.ts          ← buildMergePrompt()
│   └── examples/
│       ├── en.ts           ← 4 examples with thinking chains
│       └── index.ts        ← getExamples(language)
├── assign/
│   ├── role.ts             ← ASSIGN_ROLE
│   ├── rules.ts            ← ASSIGN_RULES with <thinking_process>
│   ├── schema.ts           ← ASSIGN_SCHEMA_TEXT
│   ├── builder.ts          ← buildAssignPrompt()
│   └── examples/
│       ├── en.ts           ← 4 examples with thinking chains
│       └── index.ts        ← getExamples(language)
└── index.ts                ← barrel re-exports build functions + shared constants
```

## Detailed Changes

### 1. Shared Utilities

**Split `shared.ts` → `shared/preambles.ts`, `shared/formatters.ts`, `shared/rules.ts`**

| Current location | New location |
|------------------|-------------|
| `SYSTEM_PREAMBLE_CN` | `shared/preambles.ts` |
| `PREFILL_PRESETS`, `PrefillPreset`, `DEFAULT_PREFILL` | `shared/preambles.ts` |
| `assembleSystemPrompt()`, `assembleUserConstraints()`, `buildMessages()` | `shared/formatters.ts` (moved from `promptFormatters.ts`) |
| `MIRROR_LANGUAGE_RULES`, `EXECUTION_TRIGGER` | `shared/rules.ts` |

**New: `formatExamples()` in `shared/formatters.ts`**

```typescript
interface PromptExample {
  input: string;       // The input text / scenario
  thinking?: string;   // Chain-of-thought reasoning (optional)
  output: string;      // The expected JSON output
  label?: string;      // e.g. "(EN/SFW)", "(EN/Vocative)" — for future filtering
}

function formatExamples(examples: PromptExample[], language = 'auto'): string
```

Adapted from OpenVault's `format-examples.js`. Filters by label tag, wraps each example in numbered XML blocks:
```xml
<example_1>
<input>
...text...
</input>
<ideal_output>
<think>
Step 1: ...reasoning...

{...json output...}
</ideal_output>
</example_1>
```

### 2. Per-Stage Restructure

Each stage (`extract`, `merge`, `assign`) gets split from one file into five:

| Component | File | Content |
|-----------|------|---------|
| Role | `role.ts` | Single exported string constant. Pure identity/behavior definition. |
| Rules | `rules.ts` | Task rules + `<thinking_process>` block with step-by-step reasoning instructions. |
| Schema | `schema.ts` | Schema text string (the example JSON shown to the model). |
| Builder | `builder.ts` | `buildXxxPrompt()` function moved from `PromptStrategy.ts`. Imports role, rules, schema, examples, and shared formatters. |
| Examples | `examples/en.ts` | Array of 4 `PromptExample` objects with thinking chains. |
| Examples | `examples/index.ts` | `getExamples(language)` — returns EN examples for now, extensible. |

### 3. Thinking Process Blocks

Each stage's `rules.ts` includes a `<thinking_process>` section with explicit reasoning steps. These teach the model a repeatable pattern that the examples reinforce.

**Extract** (character identification from text):
```
<thinking_process>
Step 1: Speaker scan — Find every quote, bracket message, telepathy, or thought
Step 2: Speaker identify — Match each to a speaker via speech verbs, action beats, pronouns
Step 3: Vocative check — Verify names inside quotes are listeners, not speakers
Step 4: Gender inference — Extract gender from pronouns or context
Step 5: Output — Compile character list with canonical names, variations, genders
</thinking_process>
```

**Merge** (character deduplication):
```
<thinking_process>
Step 1: Variation cross-check — Compare variations arrays between all character pairs
Step 2: System entity match — Link System/Interface/Blue Box/Notification
Step 3: Protagonist match — Link Protagonist to main character if present
Step 4: Conflict check — Reject merges with gender mismatches or insufficient confidence
Step 5: Output — Build merge groups, best name first
</thinking_process>
```

**Assign** (speaker attribution):
```
<thinking_process>
Step 1: Dialogue scan — Identify paragraphs with quotes, thoughts, or system messages
Step 2: Speaker match — Use speech verbs, action beats, pronouns to identify speakers
Step 3: Vocative check — Names inside quotes are listeners, not speakers
Step 4: Context check — Use paragraph sequence and previous context for ambiguous cases
Step 5: Output — Map paragraph numbers to speaker codes, skip pure narration
</thinking_process>
```

### 4. Example Coverage (4 per stage)

**Extract examples** (progressing simple → tricky):
1. Simple dialogue — two characters talking
2. System messages + first person — game brackets, "I said"
3. Vocative trap — names inside quotes are listeners
4. Gender inference from pronouns + variations merging

**Merge examples**:
1. Shared variation — characters with overlapping names
2. System entity linking — System, Interface, Blue Box
3. No merges needed — all distinct characters
4. Protagonist linking + best name ordering

**Assign examples**:
1. Simple assignment — explicit speech verbs
2. Vocative trap — listener names in quotes
3. First person narrator + context carry
4. System messages + mixed narration/dialogue

### 5. PromptStrategy.ts Changes

`PromptStrategy.ts` becomes a thin re-export layer. The `buildExtractPrompt`, `buildMergePrompt`, `buildAssignPrompt` functions move to their respective `builder.ts` files. PromptStrategy re-exports them for backward compatibility:

```typescript
// PromptStrategy.ts
export { buildExtractPrompt } from '@/config/prompts/extract/builder';
export { buildMergePrompt } from '@/config/prompts/merge/builder';
export { buildAssignPrompt } from '@/config/prompts/assign/builder';
// parseXxxResponse stays here (schema validation is separate from prompts)
```

### 6. Index / Barrel Export

```typescript
// src/config/prompts/index.ts
export { buildExtractPrompt } from './extract/builder';
export { buildMergePrompt } from './merge/builder';
export { buildAssignPrompt } from './assign/builder';

export {
  SYSTEM_PREAMBLE_CN,
  PREFILL_PRESETS,
  DEFAULT_PREFILL,
  type PrefillPreset,
} from './shared/preambles';

export { MIRROR_LANGUAGE_RULES, EXECUTION_TRIGGER } from './shared/rules';

export { formatExamples, type PromptExample } from './shared/formatters';
```

## Migration Steps

1. Create `src/config/prompts/shared/` — move preambles, split formatters and rules
2. Create `src/config/prompts/extract/` — split extract.ts into role/rules/schema/builder/examples
3. Create `src/config/prompts/merge/` — split merge.ts
4. Create `src/config/prompts/assign/` — split assign.ts
5. Update `src/config/prompts/index.ts` — barrel re-exports
6. Update `src/services/llm/promptFormatters.ts` — redirect imports to `shared/formatters.ts`
7. Update `src/services/llm/PromptStrategy.ts` — thin re-export layer
8. Delete old monolithic files (`extract.ts`, `merge.ts`, `assign.ts`, old `shared.ts`)
9. Run tests to verify no regressions

## Out of Scope

- Adding CN example files (design supports it, implementation deferred)
- Changing Zod schemas in `schemas.ts`
- Changing the 3-message topology
- Changing preamble/prefill behavior
- Changing voting/consensus logic
