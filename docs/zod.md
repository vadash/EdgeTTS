TL;DR: Drop `zod-to-json-schema` (Zod 4 has native `z.toJSONSchema()`), fix `.optional()` → `.nullable()` in `baseSchema` (critical for OpenAI `strict: true`), update `z.record()` to 2-arg form, and add refusal handling in `callStructured`.

***

## Critical: `.optional()` Breaks `strict: true`

OpenAI's `strict: true` requires **all** properties in the `required` array — fields produced by `.optional()` are omitted from `required` in the JSON Schema output, causing a schema rejection at runtime. The design's `baseSchema` must change:[1]

```typescript
// BEFORE (Zod 3 design — breaks OpenAI strict mode)
const baseSchema = z.object({
  reasoning: z.string().optional(),
});

// AFTER (Zod 4 + OpenAI strict compatible)
const baseSchema = z.object({
  reasoning: z.string().nullable(), // required, but null is valid
});
```

Tell the LLM in prompts to return `null` for `reasoning` when not used.

***

## `schemaUtils.ts` — Drop `zod-to-json-schema`

Zod 4 ships `z.toJSONSchema()` natively — the external package and your custom `schemaToOpenAISchema` shim are both gone:[2][3]

```typescript
// src/services/llm/schemaUtils.ts
import { z } from 'zod';

export function zodToJsonSchema<T>(
  schema: z.ZodType<T>,
  schemaName: string
) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      strict: true,
      // target: 'draft-7' keeps output in the JSON Schema dialect
      // OpenAI actually expects; default is Draft 2020-12 which
      // may use keywords OpenAI doesn't recognize.
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}
```

`z.toJSONSchema()` sets `additionalProperties: false` on all `z.object()` schemas by default, which is exactly what OpenAI `strict: true` requires.[3]

***

## `schemas.ts` — Zod 4 API Updates

```typescript
// src/services/llm/schemas.ts
import { z } from 'zod';

// z.ZodTypeAny eliminated in v4 — z.ZodType now defaults Input to unknown
const baseSchema = z.object({
  reasoning: z.string().nullable(),
});

export const ExtractCharacterSchema = z.object({
  canonicalName: z.string().min(1),
  variations: z.array(z.string().min(1)),
  gender: z.enum(['male', 'female', 'unknown']),
});

export const ExtractSchema = baseSchema.extend({
  characters: z.array(ExtractCharacterSchema).min(1),
});

export const MergeSchema = baseSchema.extend({
  // z.number().int() in v4 now enforces safe-integer range automatically
  merges: z.array(z.array(z.number().int().min(0)).min(2)),
});

export const AssignSchema = baseSchema.extend({
  // z.record() REQUIRES 2 args in Zod 4 — single-arg form is dropped
  assignments: z.record(z.string(), z.string()),
});

export type ExtractResponse = z.infer<typeof ExtractSchema>;
export type MergeResponse   = z.infer<typeof MergeSchema>;
export type AssignResponse  = z.infer<typeof AssignSchema>;
```

`z.record(z.string())` (single-arg) is a **breaking removal** in Zod 4. The design already uses the 2-arg form — confirm no usage of the 1-arg form exists elsewhere in the codebase.[4]

***

## `LLMApiClient.ts` — Add Refusal Handling

OpenAI structured outputs can return a `refusal` instead of content (content policy triggers). The design doesn't handle this case:[1]

```typescript
async callStructured<T>(
  { prompt, schema, schemaName, signal }: StructuredCallOptions<T>
): Promise<T> {
  const requestBody = {
    model: this.options.model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user },
    ],
    stream: false,
    response_format: zodToJsonSchema(schema, schemaName),
  };

  // ... API call ...

  const message = response.choices[0]?.message;

  // NEW: check refusal before parsing content
  if (message?.refusal) {
    throw new Error(`LLM refused: ${message.refusal}`);
  }

  const content = message?.content;
  if (!content) throw new Error('Empty response');

  // With strict: true this parse should never fail,
  // but Zod catches any edge-case provider deviation
  return schema.parse(JSON.parse(content));
}
```

***

## Dependencies

```bash
# Remove
npm uninstall zod-to-json-schema jsonrepair

# Update (v4 is a new major — check peer deps in your openai SDK version)
npm install zod@^4
```

`zod-to-json-schema` is fully obsolete. No replacement needed — `z.toJSONSchema()` is built in.[5]

***

## What Else You Could Miss

| Gap | Risk | Fix |
|---|---|---|
| `target: 'draft-7'` omitted in `z.toJSONSchema()` | OpenAI may reject Draft 2020-12 keywords (`prefixItems`, `unevaluatedProperties`) | Pass `{ target: 'draft-7' }` |
| `reasoning: null` in domain types | `nullable` leaks into your domain models | Strip it in parsers: `const { reasoning: _, ...data } = parsed` |
| `z.number().int()` now enforces `MAX_SAFE_INTEGER` | Sentence indices > 9007T trillion won't parse | Non-issue for audio, but document the constraint [4] |
| `ZodError` format changed | Custom error handling code using `.format()` or `.flatten()` will break — both deprecated in v4 | Switch to `z.treeifyError(err)` [4] |
| `.extend()` vs spread performance | Complex nested schemas slow TS compiler | Prefer object spread `z.object({ ...baseSchema.shape, ... })` for better TS perf [4] |
| Provider `strict: false` fallback | Mistral/other providers reject `strict: true` | Make `strict` a config option per-provider, already noted in risks |

Citations:
[1] [Using Zod and zodResponseFormat with OpenAI - Hooshmand.net](https://hooshmand.net/zod-zodresponseformat-structured-outputs-openai/)  
[2] [Zod v4 Available with Major Performance Improvements ...](https://www.infoq.com/news/2025/08/zod-v4-available/)  
[3] [JSON Schema - Zod](https://zod.dev/json-schema)  
[4] [Migration guide](https://zod.dev/v4/changelog)  
[5] [Migrate from zod-to-json-schema to Zod v4's native toJsonSchema()](https://github.com/Arize-ai/phoenix/issues/11497)  
[6] [2026-02-21-structured-outputs-refactor-design.md](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/65705546/d1f80b9d-4376-4fe8-93fd-8f9138376b02/2026-02-21-structured-outputs-refactor-design.md)  
[7] [[v4] Migration guide improvements #4854 - colinhacks/zod](https://github.com/colinhacks/zod/issues/4854)  
[8] [Release notes](https://zod.dev/v4)  
[9] [Versioning](https://zod.dev/v4/versioning)  
[10] [[v4] Breaking change in behavior of optional object ...](https://github.com/colinhacks/zod/issues/4883)  
[11] [Structured Outputs: Invalid schema for response_format, Extra ...](https://community.openai.com/t/structured-outputs-invalid-schema-for-response-format-extra-required-key-supplied-openai-zod-dont-work-together-for-nested-structures/989579)  
[12] [Zod Just Got a Major Upgrade: Here's Everything You're Missing](https://dev.to/shayy/zod-just-got-a-major-upgrade-heres-everything-youre-missing-55o6)  
[13] [Zod v4 Beta - Hacker News](https://news.ycombinator.com/item?id=43667925)  
[14] [Structured model outputs | OpenAI API](https://developers.openai.com/api/docs/guides/structured-outputs/)  
[15] [V5 Migration Guide](https://fastify.io/docs/latest/Guides/Migration-Guide-V5/)  
[16] [Defining AI Output Schemas Using OpenAI's Structured Outputs](https://developer.mamezou-tech.com/en/blogs/2024/08/10/openai-structured-output-intro/)