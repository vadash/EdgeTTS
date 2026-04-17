# Design: Structured Outputs Refactor

## 1. Problem Statement

The current LLM response handling pipeline has accumulated complexity:
- Three different response formats (JSON array, JSON indices, line-based)
- Multiple repair functions (`repairExtractCharacters`, `repairMergeResponse`, `repairAssignResponse`)
- `jsonrepair` library for fixing malformed JSON
- Validation functions that both validate AND repair
- Inconsistent code paths (e.g., `parseAssignResponse` validates original instead of repaired)

This technical debt exists because LLMs often output malformed or incomplete JSON. The solution is **Structured Outputs** - OpenAI's `json_schema` format with `strict: true`, which enforces schema compliance at the decoding layer through constrained decoding.

## 2. Goals & Non-Goals

**Must do:**
- Migrate all 3 stages (Extract, Merge, Assign) to use Structured Outputs (`response_format: {type: "json_schema", json_schema: {...}, strict: true}`)
- Define schemas using Zod for type safety and runtime validation
- Add optional `reasoning` field to schemas to preserve reasoning quality
- Remove all `jsonrepair` usage
- Remove all repair functions (`repairExtractCharacters`, `repairMergeResponse`, `repairAssignResponse`)
- Remove `stripThinkingTags` (no longer needed - structured outputs don't output thinking tags in the response field)
- Remove all validator functions (`validateExtractResponse`, `validateMergeResponse`, `validateAssignResponse`)
- Unify response parsing to a single pattern across all stages

**Won't do:**
- Support fallback to non-structured outputs (assume all providers support it)
- Keep legacy repair code as fallback
- Preserve line-based format for Assign (migrating to sparse JSON object)

## 3. Proposed Architecture

### Current Flow (Complex)

```
LLM Raw Response
  → stripThinkingTags()
  → extractJSON() [strips markdown, calls jsonrepair]
  → JSON.parse()
  → validate*Response() [repairs, validates]
  → parse*Response() [parses to domain objects]
  → retry if validation failed
```

### New Flow (Simple)

```
LLM Structured Response (guaranteed valid JSON)
  → JSON.parse() [direct, no repair needed]
  → Zod schema.parse() [runtime type validation]
  → domain objects
```

**Key insight:** With `strict: true` structured outputs, the LLM cannot return malformed JSON. The decoding layer physically restricts tokens to valid schema-compliant output.

### Stage Specifications

| Stage | Schema | Response Format |
|-------|--------|-----------------|
| **Extract** | `ExtractSchema` | `{reasoning?: string, characters: [...]}` |
| **Merge** | `MergeSchema` | `{reasoning?: string, merges: [[0,1], [2,3]]}` |
| **Assign** | `AssignSchema` | `{reasoning?: string, assignments: {0: "A", 5: "B"}}` |

### Assign Stage Format Change

**Before** (line-based):
```
0:A
5:B
12:C
```

**After** (sparse JSON object):
```json
{
  "reasoning": "Character A is the narrator...",
  "assignments": {
    "0": "A",
    "5": "B",
    "12": "C"
  }
}
```

Note: Keys are strings (JSON object limitation), cast to numbers during parsing.

## 4. Data Models / Schema

### Zod Schemas (Zod v4)

```typescript
// src/services/llm/schemas.ts
import { z } from 'zod';

// Base schema with nullable reasoning field
// CRITICAL: .nullable() not .optional() for OpenAI strict: true compatibility
// .optional() omits from required array, breaking strict mode
// Use .transform() to convert null → undefined for clean domain types
const baseSchema = z.object({
  reasoning: z.string().nullable().transform(v => v ?? undefined),
});

// Extract stage
export const ExtractCharacterSchema = z.object({
  canonicalName: z.string().min(1),
  variations: z.array(z.string()).min(1),
  gender: z.enum(['male', 'female', 'unknown']),
});

export const ExtractSchema = baseSchema.extend({
  characters: z.array(ExtractCharacterSchema).min(1),
});

// Merge stage
export const MergeSchema = baseSchema.extend({
  merges: z.array(
    z.array(z.number().int().min(0)).min(2) // Each group has 2+ indices
  ),
});

// Assign stage
// NOTE: z.record() requires 2 args in Zod 4 (single-arg form removed)
export const AssignSchema = baseSchema.extend({
  assignments: z.record(z.string(), z.string()), // Sparse: {"0": "A", "5": "B"}
});

// Type exports
export type ExtractResponse = z.infer<typeof ExtractSchema>;
export type MergeResponse = z.infer<typeof MergeSchema>;
export type AssignResponse = z.infer<typeof AssignSchema>;
```

### Zod to JSON Schema Conversion (Zod v4 Native)

```typescript
// src/services/llm/schemaUtils.ts
import { z } from 'zod';

export function zodToJsonSchema<T>(
  schema: z.ZodType<T>,
  schemaName: string
): {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
} {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      strict: true,
      // Zod 4 has native toJSONSchema() - no external package needed
      // target: 'draft-7' ensures compatibility with OpenAI's expectations
      // (default Draft 2020-12 may use keywords OpenAI doesn't recognize)
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}
```

**Key Zod v4 changes:**
- Native `z.toJSONSchema()` eliminates `zod-to-json-schema` dependency
- `target: 'draft-7'` option for OpenAI compatibility
- Sets `additionalProperties: false` on all objects by default (required for `strict: true`)

### Request Body Structure

```typescript
// Example request for Extract stage
{
  model: "gpt-4o-mini",
  messages: [...],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "ExtractSchema",
      strict: true,
      schema: {
        type: "object",
        properties: {
          reasoning: { type: "string" },
          characters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                canonicalName: { type: "string" },
                variations: { type: "array", items: { type: "string" } },
                gender: { type: "string", enum: ["male", "female", "unknown"] }
              },
              required: ["canonicalName", "variations", "gender"]
            }
          }
        },
        required: ["characters"]
      }
    }
  }
}
```

## 5. Interface / API Design

### Modified LLMApiClient

```typescript
// src/services/llm/LLMApiClient.ts

export interface StructuredCallOptions<T> {
  prompt: LLMPrompt;
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}

export class LLMApiClient {
  /**
   * Call LLM with structured output enforcement.
   * Returns validated, typed result directly.
   */
  async callStructured<T>({
    prompt,
    schema,
    schemaName,
    signal,
  }: StructuredCallOptions<T>): Promise<T> {
    const requestBody: any = {
      model: this.options.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: false, // Structured outputs require non-streaming
      response_format: zodToJsonSchema(schema, schemaName),
    };

    // ... API call ...

    const message = response.choices[0]?.message;

    // Check for refusal (content policy triggers)
    if (message?.refusal) {
      throw new Error(`LLM refused: ${message.refusal}`);
    }

    const content = message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const parsed = JSON.parse(content);
    return schema.parse(parsed); // Zod runtime validation
  }
}
```

**Refusal handling:** OpenAI structured outputs can return a `refusal` field instead of `content` when content policy is triggered. This is checked before parsing content.

### Simplified PromptStrategy

```typescript
// src/services/llm/PromptStrategy.ts (refactored)

import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
import type { ExtractContext, MergeContext, AssignContext } from './types';

// Prompt builders unchanged
export function buildExtractPrompt(textBlock: string): LLMPrompt { /* ... */ }
export function buildMergePrompt(characters: LLMCharacter[]): LLMPrompt { /* ... */ }
export function buildAssignPrompt(...): LLMPrompt { /* ... */ }

// Parsers simplified to pure type extraction
export function parseExtractResponse(response: unknown): ExtractResponse {
  return ExtractSchema.parse(response);
}

export function parseMergeResponse(response: unknown, _context: MergeContext): MergeResponse {
  return MergeSchema.parse(response);
}

export function parseAssignResponse(response: unknown, context: AssignContext): AssignResult {
  const parsed = AssignSchema.parse(response);

  // Convert string keys to numbers for sparse assignments
  const speakerMap = new Map<number, string>();
  for (const [key, code] of Object.entries(parsed.assignments)) {
    const index = parseInt(key, 10);
    if (context.codeToName.has(code)) {
      speakerMap.set(index, code);
    }
  }
  return { speakerMap };
}
```

### Simplified LLMVoiceService

```typescript
// src/services/llm/LLMVoiceService.ts

async extractCharacters(textBlock: string): Promise<LLMCharacter[]> {
  const prompt = buildExtractPrompt(textBlock);
  const response = await this.llm.callStructured({
    prompt,
    schema: ExtractSchema,
    schemaName: 'ExtractSchema',
  });
  return response.characters;
}

async mergeCharactersWithLLM(characters: LLMCharacter[]): Promise<number[][]> {
  const prompt = buildMergePrompt(characters);
  const response = await this.llm.callStructured({
    prompt,
    schema: MergeSchema,
    schemaName: 'MergeSchema',
  });
  return response.merges;
}

async assignSpeakers(...): Promise<Map<number, string>> {
  const prompt = buildAssignPrompt(...);
  const response = await this.llm.callStructured({
    prompt,
    schema: AssignSchema,
    schemaName: 'AssignSchema',
  });
  // ... convert to Map ...
}
```

## 6. Files Changed

### Files to Delete (entropy reduction)

| File | Lines Removed | Reason |
|------|---------------|--------|
| `src/utils/llmUtils.ts` | ~40 | `stripThinkingTags`, `extractJSON` - no longer needed |
| `src/services/llm/ResponseValidators.ts` | ~350 | All validators and repair functions obsolete |

### Files to Modify

| File | Changes |
|------|---------|
| `src/services/llm/LLMApiClient.ts` | Add `callStructured` method, remove `extractJSON` usage |
| `src/services/llm/PromptStrategy.ts` | Remove validators, simplify parsers to Zod.parse |
| `src/services/llm/LLMVoiceService.ts` | Use `callStructured`, remove retry-with-validation logic |
| `src/config/prompts/*.ts` | Update prompts to mention structured output format |

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/llm/schemas.ts` | Zod schema definitions |
| `src/services/llm/schemaUtils.ts` | Zod to JSON Schema conversion |

### Dependencies

```bash
# Install Zod v4
npm install zod@^4

# Remove - no longer needed
npm uninstall jsonrepair
```

**Note:** `zod-to-json-schema` is NOT needed - Zod 4 has native `toJSONSchema()`.

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| Provider doesn't support `json_schema` | **Fail hard:** Design requires provider support. Throw clear error on structured output failure. |
| Content policy refusal | Check `message.refusal` and throw immediately with refusal message. |
| `strict: true` schema rejection | Ensure `.nullable()` not `.optional()` for reasoning field. Use `target: 'draft-7'` in `toJSONSchema()`. |
| Structured outputs degrade reasoning quality | LLM can still think - prompt to use `reasoning` field (or `null` if not needed). |
| `z.record()` single-arg form | Zod 4 removed single-arg form - must use `z.record(keySchema, valueSchema)`. |
| `ZodError` format changed | Use `z.treeifyError(err)` instead of deprecated `.format()` or `.flatten()`. |
| `z.number().int()` safe integer limit | Zod 4 enforces `MAX_SAFE_INTEGER` - non-issue for audio sentence indices. |
| Streaming disabled | Accept tradeoff: structured outputs > streaming for reliability. |
| Zod runtime validation fails despite schema | Should never happen with `strict: true`, but Zod catches it - fail with clear error. |
| Assign stage sparse object has string keys | Parse keys as integers; validate range against sentenceCount. |
| Large outputs (500+ sentences) hit token limits | Already handled by current implementation; structured output doesn't change this. |

## 8. Migration Steps

1. Install Zod v4: `npm install zod@^4`
2. Remove `jsonrepair`: `npm uninstall jsonrepair`
3. Create `schemas.ts` with Zod v4 schemas (use `.nullable()` not `.optional()`)
4. Create `schemaUtils.ts` using native `z.toJSONSchema()` with `target: 'draft-7'`
5. Add `callStructured` method to `LLMApiClient` with refusal handling
6. Migrate Extract stage first (easiest, already JSON)
7. Migrate Merge stage
8. Migrate Assign stage (format change)
9. Delete `llmUtils.ts` and `ResponseValidators.ts`
10. Update prompts to mention `null` for reasoning when not needed
11. Test with real providers

## 9. Zod v4 Migration Checklist

- [ ] Change `reasoning: z.string().optional()` → `z.string().nullable().transform(v => v ?? undefined)`
- [ ] Verify all `z.record()` calls use 2-arg form: `z.record(keySchema, valueSchema)`
- [ ] Use `z.toJSONSchema(schema, { target: 'draft-7' })` in schemaUtils
- [ ] Add refusal check: `if (message?.refusal) throw new Error(...)`
- [ ] Update error handling to use `z.treeifyError(err)` if needed
- [ ] Remove `zod-to-json-schema` dependency (if present)
- [ ] Confirm `z.ZodType<T>` usage (no `z.ZodTypeAny`)

## 10. Code Reduction Estimate

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| `llmUtils.ts` | 40 lines | 0 lines (deleted) | -40 |
| `ResponseValidators.ts` | 350 lines | 0 lines (deleted) | -350 |
| `PromptStrategy.ts` parsers | ~80 lines | ~30 lines | -50 |
| `LLMApiClient.ts` | ~200 lines | ~180 lines | -20 |
| New files (schemas, utils) | 0 lines | ~60 lines (no zod-to-json-schema) | +60 |
| **Net** | **~670 lines** | **~270 lines** | **-400 lines (60% reduction)** |

## 11. References

- [Zod v4 JSON Schema](https://zod.dev/json-schema)
- [Zod v4 Migration Guide](https://zod.dev/v4/changelog)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs/)
- [Zod + OpenAI Strict Mode Guide](https://hooshmand.net/zod-zodresponseformat-structured-outputs-openai/)

## 12. Implementation Plan

See `docs/plans/2026-02-21-structured-outputs-plan.md` for the step-by-step TDD implementation plan.

- [Zod v4 JSON Schema](https://zod.dev/json-schema)
- [Zod v4 Migration Guide](https://zod.dev/v4/changelog)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs/)
- [Zod + OpenAI Strict Mode Guide](https://hooshmand.net/zod-zodresponseformat-structured-outputs-openai/)
