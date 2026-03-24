# Import Robust JSON Parsing from openvault

**Date:** 2026-03-24
**Status:** Approved

## Problem

EdgeTTS's current `safeParseJSON` has a linear repair pipeline. It lacks the multi-tier fallback robustness of openvault's implementation, which handles more LLM output edge cases through explicit tiered recovery.

## Solution

Replace EdgeTTS's JSON parsing implementation with openvault's 5-tier waterfall system, keeping the result object return type `{success, data?, error?}`.

## Functions to Port (JS → TypeScript)

From `C:\projects\openvault\src\utils\text.js`:

| Function | Purpose |
|----------|---------|
| `normalizeText` | Fix invisible chars, smart quotes, control characters |
| `extractJsonBlocks` | Extract ALL balanced JSON blocks (not just last) |
| `scrubConcatenation` | Fix LLM string concatenation hallucinations |
| `stripThinkingTags` | Strip reasoning/thinking tags (regex-based) |
| `stripMarkdownFences` | Strip ``` and ~~~ code fences |
| `safeParseJSON` | 5-tier waterfall with result object |

## Functions to Delete

From `C:\projects\EdgeTTS\src\utils\text.ts`:

- `stripPairedTag` (index-based, replaced by regex version)
- `stripBracketTag` (index-based, replaced by regex version)
- `extractBalancedJSON` (last-block only, replaced by `extractJsonBlocks`)
- Current `safeParseJSON`

## TypeScript Adaptation

Add optional Zod schema validation to `safeParseJSON`:

```typescript
export function safeParseJSON<T>(
  input: unknown,
  options?: {
    schema?: z.ZodType<T>;
    minimumBlockSize?: number;
    onError?: (context: ErrorContext) => void;
  }
): { success: boolean; data?: T; error?: Error; errorContext?: object }
```

If `schema` provided, run `schema.parse(data)` after successful JSON repair.

## 5-Tier Waterfall

```
Tier 0: Input Validation (null, empty, already object)
Tier 1: Native JSON.parse
Tier 2: extractJsonBlocks + jsonrepair
Tier 3: normalizeText + extractJsonBlocks + jsonrepair
Tier 4: normalizeText + extractJsonBlocks + scrubConcatenation + jsonrepair
Tier 5: Failure (return error result)
```

## Caller Update

`LLMApiClient.callStructured` (single production caller):

```typescript
const result = safeParseJSON(content, { schema });
if (!result.success) {
  throw new RetriableError(`JSON parse failed: ${result.error!.message}`);
}
return result.data;
```

## Test Updates

Adapt existing tests in `text.test.ts`:
- Change from throw-based assertions to result object checks
- Test `result.success` boolean
- Access data via `result.data`

## Files Changed

- `src/utils/text.ts` — Replace JSON parsing implementation
- `src/utils/text.test.ts` — Update tests for result object
- `src/services/llm/LLMApiClient.ts` — Update caller to handle result object
- `src/services/llm/CLAUDE.md` — Update documentation