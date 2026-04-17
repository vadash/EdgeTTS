# LLM Robustness Improvements — Design v2.1

## 1. Overview

Three targeted improvements to the LLM pipeline based on code review feedback from the v2 robustness update. Each addresses a specific failure mode: browser freezing from malicious LLM output, suboptimal prefill selection for non-Chinese texts, and future-proofing for OpenAI Structured Outputs.

## 2. Goals

1. **Eliminate Catastrophic Backtracking**: Replace regex-based thinking tag stripping with non-regex string extraction
2. **Language-Aware Prefill Selection**: Automatically choose CN/EN prefill preset based on detected content language
3. **Schema Strictness**: Add `.strict()` to all Zod schemas to prevent hallucinated keys

## 3. Detailed Design

### 3.1 Catastrophic Backtracking Fix

**Problem**: The regex `/[\s\S]*?/` in `stripThinkingTags` can cause catastrophic backtracking if a model generates an unclosed `<think>` tag followed by thousands of characters. The browser's main thread freezes.

**Current Implementation**:
```typescript
// src/utils/text.ts
function stripThinkingTags(text: string): string {
  return text
    .replace(/<(think|thinking)...>[\s\S]*?<\/\1>/gi, '')  // DANGEROUS
    .replace(/\[THINK\][\s\S]*?\[\/\1\]/gi, '');         // DANGEROUS
}
```

**New Implementation**:
Replace regex for paired tags with index-based string extraction that handles case-insensitivity and attributes. Keep regex only for simple patterns (asterisk thinking, orphaned closing tags) that don't use `[\s\S]*?`.

```typescript
// src/utils/text.ts
function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  let cleaned = text;

  // Use non-regex extraction for paired tags (case-insensitive, attribute-aware)
  cleaned = stripPairedTag(cleaned, 'think');
  cleaned = stripPairedTag(cleaned, 'thinking');
  cleaned = stripPairedTag(cleaned, 'thought');
  cleaned = stripPairedTag(cleaned, 'reasoning');
  cleaned = stripPairedTag(cleaned, 'tool_call');
  cleaned = stripPairedTag(cleaned, 'search');
  cleaned = stripBracketTag(cleaned, 'THINK');
  cleaned = stripBracketTag(cleaned, 'THOUGHT');
  cleaned = stripBracketTag(cleaned, 'REASONING');
  cleaned = stripBracketTag(cleaned, 'TOOL_CALL');

  // Safe regex patterns (bounded, no [\s\S]*?)
  cleaned = cleaned.replace(/\*thinks?:[^*]*\*/gi, '');           // Asterisk thinking
  cleaned = cleaned.replace(/\(thinking:[^)]*\)/gi, '');          // Parenthesized
  cleaned = cleaned.replace(/^.*?<\/(think|thinking)>/i, '');     // Orphaned close

  return cleaned.trim();
}

/**
 * Case-insensitive, attribute-aware tag stripping.
 * Handles: <think>, <THINK>, <think type="internal">
 * Syncs lowercase index positions with original case string.
 */
function stripPairedTag(text: string, tagName: string): string {
  let result = text;
  let lowerResult = result.toLowerCase();
  const openTag = `<${tagName.toLowerCase()}`;
  const closeTag = `</${tagName.toLowerCase()}>`;

  while (true) {
    const startIdx = lowerResult.indexOf(openTag);
    if (startIdx === -1) break; // No more tags

    // Find the closing bracket of the opening tag to handle attributes
    const openEndIdx = lowerResult.indexOf('>', startIdx);
    if (openEndIdx === -1) break; // Malformed tag, abort to be safe

    const closeIdx = lowerResult.indexOf(closeTag, openEndIdx);
    if (closeIdx === -1) break; // Unclosed tag, leave it alone

    const closeEndIdx = closeIdx + closeTag.length;

    // Slice the original case-sensitive string
    result = result.slice(0, startIdx) + result.slice(closeEndIdx);

    // Re-sync the lowercase version for the next iteration
    lowerResult = result.toLowerCase();
  }

  return result;
}
```

**Key Decisions**:
- **Case-insensitive**: Syncs lowercase string for finding, slices original for preserving case
- **Attribute-aware**: Finds `>` after opening tag to handle `<think type="internal">`
- **Unclosed safety**: If no closing tag, stop processing to avoid over-stripping

---

### 3.2 Dynamic Prefill Language Selection

**Problem**: Using `cn_compliance` prefill for English text forces the model to switch languages mid-context, potentially degrading reasoning quality in smaller models (<8B parameters).

**Current Implementation**:
```typescript
// src/config/prompts/shared.ts
export const DEFAULT_PREFILL: PrefillPreset = 'cn_compliance';  // Always CN
```

**New Implementation**:
Add an `'auto'` prefill preset that selects based on detected language:

```typescript
// src/config/prompts/shared.ts
export const PREFILL_PRESETS = {
  cn_compliance: '...',
  en_compliance: '...',
  step_by_step: '...',
  pure_think: '...',
  json_only: '...',
  none: '',
  auto: '',  // Placeholder - dynamically resolved
} as const;

export type PrefillPreset = keyof typeof PREFILL_PRESETS;

export const DEFAULT_PREFILL: PrefillPreset = 'auto';  // Changed from 'cn_compliance'
```

Modify `buildMessages` to accept detected language and resolve `auto`:

```typescript
// src/services/llm/promptFormatters.ts
export function buildMessages(
  systemBody: string,
  userBody: string,
  detectedLanguage: string = 'en',  // NEW parameter
  prefill: PrefillPreset = DEFAULT_PREFILL,
  preamble: string = SYSTEM_PREAMBLE_CN,
): LLMMessage[] {
  // Resolve 'auto' based on detected language
  let actualPrefill = prefill;
  if (prefill === 'auto') {
    actualPrefill = detectedLanguage === 'zh' ? 'cn_compliance' : 'en_compliance';
  }

  const prefillContent = PREFILL_PRESETS[actualPrefill];
  // ... rest unchanged
}
```

**Propagation**: Pass `detectedLanguage` down the chain from Orchestrator → LLMVoiceService → PromptStrategy:

```typescript
// src/services/llm/LLMVoiceService.ts
export interface LLMVoiceServiceOptions {
  // ... existing props
  detectedLanguage?: string; // NEW
}

// src/services/ConversionOrchestrator.ts
const extractLLMOptions: LLMServiceFactoryOptions = {
  // ... existing
  detectedLanguage: input.detectedLanguage, // Pass from input snapshot
};

// src/services/llm/PromptStrategy.ts
export function buildExtractPrompt(
  textBlock: string,
  detectedLanguage: string = 'en',  // NEW parameter
): LLMMessage[] {
  const p = LLM_PROMPTS.extract;
  const sys = assembleSystemPrompt(p.role, p.examples);
  const constraints = assembleUserConstraints(p.rules, p.schemaText);
  const user = p.userTemplate.replace('{{text}}', textBlock);

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}

// Same pattern for buildMergePrompt and buildAssignPrompt
```

**Architectural Note**: Passing `detectedLanguage` as a parameter preserves the pure-function design of `PromptStrategy.ts` and keeps it testable without mocking global state.

**Language Mapping**:
| Detected Language | Prefill Selected |
|------------------|------------------|
| `zh` (Chinese)   | `cn_compliance`  |
| All others       | `en_compliance`  |

---

### 3.3 Zod Schema Strictness

**Problem**: Without `.strict()`, models can hallucinate additional keys in JSON objects. OpenAI's Strict JSON Schema mode (and Zod 4's strict mode) rejects these.

**Current Implementation**:
```typescript
// src/services/llm/schemas.ts
export const ExtractCharacterSchema = z.object({
  canonicalName: z.string().min(1),
  variations: z.array(z.string().min(1)),
  gender: z.enum(['male', 'female', 'unknown']),
});  // Non-strict: allows extra keys
```

**New Implementation**:
```typescript
// src/services/llm/schemas.ts
export const ExtractCharacterSchema = z.object({
  canonicalName: z.string().min(1),
  variations: z.array(z.string().min(1)),
  gender: z.enum(['male', 'female', 'unknown']),
}).strict();  // Rejects unknown keys

export const ExtractSchema = baseSchema.extend({
  characters: z.array(ExtractCharacterSchema).min(1),
}).strict();

export const MergeSchema = baseSchema.extend({
  merges: z.array(z.array(z.number().int().min(0)).min(2)),
}).strict();

export const AssignSchema = baseSchema.extend({
  assignments: z.record(z.string(), z.string()),
}).strict();
```

**Note**:
- The `baseSchema` includes `reasoning` which is nullable. When a field is omitted entirely (OpenAI's native structured outputs may omit nullables), `.default(null)` handles it. Adding `.strict()` to the final schema doesn't affect this behavior.
- `z.record(z.string(), z.string())` (used in `AssignSchema` for `assignments`) inherently accepts dynamic keys and does not use `.strict()`. Only the root object and nested objects with fixed keys get `.strict()`.

---

## 4. File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/utils/text.ts` | Modify | Replace regex-based `stripThinkingTags` with index-based extraction (case-insensitive, attribute-aware) |
| `src/utils/text.test.ts` | Modify | Add tests for edge cases (unclosed tags, large inputs, case variants, attributes) |
| `src/config/prompts/shared.ts` | Modify | Add `'auto'` to `PREFILL_PRESETS`, change `DEFAULT_PREFILL` |
| `src/services/llm/promptFormatters.ts` | Modify | Add `detectedLanguage` param, resolve `'auto'` |
| `src/services/llm/promptFormatters.test.ts` | Modify | Add tests for `'auto'` resolution |
| `src/services/llm/PromptStrategy.ts` | Modify | Add `detectedLanguage` param to all `build*Prompt` functions |
| `src/services/llm/LLMVoiceService.ts` | Modify | Add `detectedLanguage` to `LLMVoiceServiceOptions`, pass to prompt builders |
| `src/services/ConversionOrchestrator.ts` | Modify | Pass `input.detectedLanguage` to LLM service options |
| `src/services/llm/schemas.ts` | Modify | Add `.strict()` to all schemas (except `z.record()` internals) |
| `src/services/llm/schemas.test.ts` | Modify | Add tests for strict rejection of extra keys |

---

## 5. Testing Strategy

### 5.1 Backtracking Fix Tests
- Large unclosed tag (10k chars) → should not freeze, should return original
- Nested tags → should strip outermost pair
- Multiple tags → should strip all
- Malformed tags (no close) → should stop at first unclosed
- **Case variants**: `<think>`, `<THINK>`, `<Think>` → all stripped
- **Attributes**: `<think type="internal">content</think>` → stripped correctly

### 5.2 Prefill Selection Tests
- `detectedLanguage='zh'` + `prefill='auto'` → `cn_compliance`
- `detectedLanguage='en'` + `prefill='auto'` → `en_compliance`
- Explicit `prefill='pure_think'` → `pure_think` (override)

### 5.3 Strict Schema Tests
- Valid object → passes
- Extra keys → throws ZodError
- Missing required → throws ZodError
- Correct handling of omitted `reasoning` field

---

## 6. Rollback Plan

Each change is independent and can be reverted separately:

1. **Backtracking fix**: Revert `text.ts` to previous regex-based version
2. **Prefill selection**: Change `DEFAULT_PREFILL` back to `'cn_compliance'`
3. **Strictness**: Remove `.strict()` calls from schemas

---

## 7. Acceptance Criteria

- [ ] `stripThinkingTags` handles 10k character unclosed tag without freezing (manual test)
- [ ] Unit tests for `stripPairedTag` pass (case-insensitive, attribute-aware, unclosed safety)
- [ ] `buildMessages` with `prefill='auto'` selects `cn_compliance` for `zh`, `en_compliance` otherwise
- [ ] `detectedLanguage` flows correctly: Orchestrator → LLMVoiceService → PromptStrategy → buildMessages
- [ ] All Zod schemas reject objects with extra keys at root level (verified in tests)
- [ ] `z.record()` fields (assignments) accept dynamic keys as expected
- [ ] No regression in existing LLM integration tests
