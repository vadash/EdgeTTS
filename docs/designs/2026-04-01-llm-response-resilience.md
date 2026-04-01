# LLM Response Resilience Fixes

**Date:** 2026-04-01
**Status:** Approved
**Scope:** `src/utils/text.ts`, `src/services/llm/schemas.ts`

## Problem

When using non-OpenAI models (e.g. "SMART" alias via OpenRouter), the LLM frequently returns structurally valid JSON that fails Zod validation due to:

1. **Key typos** — `"reasonin"` or `"reason"` instead of `"reasoning"`, rejected by `.strict()`
2. **Naked arrays** — `[{canonicalName: "John", ...}]` instead of `{reasoning: null, characters: [...]}`
3. **Flattened assignments** — `{"0": "A", "1": "B"}` at root instead of `{assignments: {"0": "A", "1": "B"}}`
4. **XML wrappers** — `<json_tool_call>` and `<arg_key` tags not stripped before JSON parsing

Evidence: `E:\books\Sublight Drive\logs\1\a*.json` show all four failure modes against the SMART model.

## Design

### Fix 1: Drop `.strict()` from schemas

**File:** `src/services/llm/schemas.ts`

Remove `.strict()` from all four schemas. Zod's default behavior strips unrecognized keys and validates only defined fields. Since `reasoning` has `.nullable().default(null)`, a typo'd key means `reasoning` is absent and defaults to null — the pipeline continues with valid data.

**Tradeoff:** We lose detection of unexpected extra keys. The logs show this is systematic SMART model behavior, not rare hallucination, so the tradeoff is acceptable.

### Fix 2: Schema-aware auto-recovery in `safeParseJSON`

**File:** `src/utils/text.ts`

Add a recovery step after JSON parsing succeeds but before `schema.parse()` runs (in Tiers 2-4). Two recovery paths:

**Array at root:** If the parsed result is an array and the Zod schema expects an object, inspect the schema's `.shape` to find the field that accepts an array. Wrap the result as `{ reasoning: null, [fieldName]: parsedArray }`.

- `ExtractSchema` → `characters` field is `ZodArray` → `{ reasoning: null, characters: [...] }`
- `MergeSchema` → `merges` field is `ZodArray` → `{ reasoning: null, merges: [...] }`
- `AssignSchema` → no array field; this path won't apply

**Flattened assignments dict:** If the parsed result is a plain object missing all recognized top-level keys (`reasoning`, `assignments`, `characters`, `merges`) AND has numeric-string keys, wrap as `{ reasoning: null, assignments: parsed }`.

Both recoveries run after `jsonrepair` but before `schema.parse()`, so the result still goes through full schema validation.

### Fix 3: Expand tag stripping in `stripThinkingTags`

**File:** `src/utils/text.ts`

Two additions to the regex phase:

1. **`<json_tool_call>`** — Change the existing `tool_call` regex to `<(?:json_)?tool_call(?:\s+[^>]*)?>` so it matches both `<tool_call...>` and `<json_tool_call...>`. Same for the closing tag and orphan patterns.

2. **`<arg_key...>`** — Add a new strip pattern: `/<arg_key[^>]*>[\s\S]*?<\/arg_key>/gi`. Unlike `<arg_value` (which is unwrapped because it may contain JSON), `<arg_key` contains key names and should be stripped entirely.

### Out of scope

- Provider-specific `json_schema` → `json_object` downgrade (may be addressed separately if needed)
- Prompt changes (all prompts and examples already consistently use `"reasoning"`)

## Files changed

| File | Change |
|------|--------|
| `src/services/llm/schemas.ts` | Remove `.strict()` from 4 schemas |
| `src/utils/text.ts` | Add recovery logic in `safeParseJSON`; expand tag patterns in `stripThinkingTags` |
