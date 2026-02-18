# Design: Auto-Repair Extract LLM Responses

## 1. Problem Statement

The character-extraction LLM pass produces frequent validation failures that trigger expensive retries. Analysis of a real 85-block run shows **17 out of 39 blocks** (44%) needed at least one retry, with some needing 3 retries. Each retry costs an API call and adds 5-30s of backoff delay.

The failures are overwhelmingly predictable and mechanically repairable:

| Error Type | Frequency | Example |
|---|---|---|
| Missing `gender` field | ~70% of failures | `{"canonicalName":"Erick","variations":["Erick"]}` |
| `gender: null` | ~15% | `{"canonicalName":"Erick","variations":["Erick"],"":null}` |
| Missing `variations` array | ~10% | `{"canonicalName":"Jane"}` |
| `variations: null` | ~5% | `{"canonicalName":"Rats","variations":null}` |
| Truncated JSON | occasional | Response cut off mid-object |

All of these have deterministic repairs. Retrying wastes tokens on responses the LLM already got 90% correct.

## 2. Goals & Non-Goals

**Must do:**
- Auto-repair missing/null `gender` → `"unknown"`
- Auto-repair missing/null `variations` → `[canonicalName]`
- Drop characters with empty/missing `canonicalName` (non-repairable)
- Attempt bracket-closing on truncated JSON
- Log all repairs as warnings for observability
- Return `valid: true` when repairs succeed (skip retry)

**Won't do:**
- Change prompt text (already optimized in e2c6a80)
- Auto-repair assign or merge responses (different failure patterns)
- Add fuzzy matching or semantic repair (too complex, too risky)

## 3. Proposed Architecture

**Single-function change** in `validateExtractResponse` within `ResponseValidators.ts`.

```
LLM Response
  → extractJSON() [existing: strips markdown, thinking tags]
  → tryRepairJSON() [NEW: bracket-closing for truncated JSON]
  → JSON.parse()
  → repairCharacters() [NEW: fix gender, variations, drop bad entries]
  → existing field validation (now passes)
  → return { valid: true, repairedResponse }
```

The `LLMValidationResult` type gets an optional `repairedResponse?: string` field. When present, `ExtractPromptStrategy.parseResponse` uses it instead of the raw response.

## 4. Data Models / Schema

### LLMValidationResult (modified)

```typescript
export interface LLMValidationResult {
  valid: boolean;
  errors: string[];
  repairedResponse?: string;  // NEW: JSON string of repaired data
}
```

### Repair Rules Table

| Field | Condition | Repair | Log |
|---|---|---|---|
| `gender` | missing, null, or not in `["male","female","unknown"]` | Set `"unknown"` | `[extract] Auto-repaired gender for "Name"` |
| `variations` | missing, null, or not array | Set `[canonicalName]` | `[extract] Auto-repaired variations for "Name"` |
| `canonicalName` | missing, null, empty string | **Remove character entirely** | `[extract] Dropped character with no name` |
| JSON | Truncated (parse fails) | Try appending `]}`, `}]}`, `"}]}` | `[extract] Repaired truncated JSON` |

## 5. Interface / API Design

### New helper: `tryRepairJSON(raw: string): string`

```typescript
/**
 * Attempt to close truncated JSON by appending missing brackets.
 * Tries progressively more aggressive closures.
 * Returns original string if no repair needed or all repairs fail.
 */
function tryRepairJSON(raw: string): string
```

### Modified: `validateExtractResponse(response: string): LLMValidationResult`

Same signature, but now:
1. Calls `tryRepairJSON` if `JSON.parse` fails
2. Repairs individual character objects in-place
3. Sets `repairedResponse` on result if any repairs were made
4. Only returns `valid: false` for truly unrecoverable issues (no characters at all, completely garbled response)

### Modified: `ExtractPromptStrategy.parseResponse`

```typescript
parseResponse(response: string, _context: ExtractContext): ExtractResponse {
  // Use repaired response if validation provided one
  const validation = this.validateResponse(response, _context);
  const toParse = validation.repairedResponse ?? response;
  const cleaned = extractJSON(toParse);
  return JSON.parse(cleaned) as ExtractResponse;
}
```

Wait — this calls validate twice (once in the retry loop, once in parse). Better approach: store the repaired JSON string in the validation result, and have `callWithRetry` pass it through. But `callWithRetry` returns the raw response string.

**Simpler approach:** Make `parseResponse` also apply repairs independently. Since repairs are deterministic and idempotent, running them twice is fine and keeps the interface clean.

```typescript
parseResponse(response: string, _context: ExtractContext): ExtractResponse {
  const cleaned = extractJSON(response);
  const repaired = repairExtractJSON(cleaned);  // same logic as validator
  return JSON.parse(repaired) as ExtractResponse;
}
```

Extract the repair logic into a shared `repairExtractJSON(jsonStr: string): string` function used by both validate and parse.

## 6. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| Auto-repair masks a model regression (quality drops, we don't notice) | Log all repairs as warnings; they remain visible in logs |
| Bracket-closing creates valid but wrong JSON (mismatched structure) | Only attempt 3 specific suffixes; validate structure after repair |
| Dropping characters with no name loses data | These entries had no usable data anyway; LLM will often catch them in subsequent merge pass |
| `repairedResponse` concept couples validator to parser | Mitigated by shared `repairExtractJSON` function—both sides apply same logic independently |
| Truncated responses may indicate a deeper issue (context too long, timeout) | Keep the warning logs; don't suppress the signal, just avoid the retry cost |

## Files Changed

1. `src/services/llm/ResponseValidators.ts` — Add `tryRepairJSON`, `repairCharacterEntries`, modify `validateExtractResponse`
2. `src/services/llm/PromptStrategy.ts` — Update `ExtractPromptStrategy.parseResponse` to use shared repair
3. `src/state/types.ts` — Add `repairedResponse?: string` to `LLMValidationResult` (optional, may not be needed if both sides repair independently)
