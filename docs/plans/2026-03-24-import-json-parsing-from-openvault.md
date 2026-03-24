# Import JSON Parsing from openvault - Implementation Plan

**Goal:** Replace EdgeTTS's `safeParseJSON` with openvault's 5-tier waterfall implementation, returning `{success, data?, error?}` result object.
**Architecture:** Port 6 functions from openvault, delete 4 functions from EdgeTTS, update single caller and tests.
**Tech Stack:** TypeScript, Zod, jsonrepair

---

## File Structure Overview

- **Modify:** `src/utils/text.ts` — Replace JSON parsing implementation
- **Modify:** `src/utils/text.test.ts` — Update tests for result object
- **Modify:** `src/services/llm/LLMApiClient.ts` — Handle result object
- **Modify:** `src/services/llm/CLAUDE.md` — Update documentation

---

### Task 1: Port helper functions from openvault

**Files:**
- Modify: `src/utils/text.ts`

**Common Pitfalls:**
- Remember to import `jsonrepair` at the top (already exists)
- Keep existing imports (`z`, `RetriableError`) — they're still needed
- Convert JSDoc comments to TypeScript

- [ ] Step 1: Delete the following functions from `text.ts`:
  - `stripPairedTag`
  - `stripBracketTag`
  - `extractBalancedJSON`
  - Current `safeParseJSON`

- [ ] Step 2: Add `normalizeText` function after imports:

```typescript
/**
 * Normalize text by fixing invisible characters and typographical anomalies.
 * - Strips unescaped control characters (\x00-\x1F), preserving \n, \r, \t
 * - Replaces smart/curly quotes with standard quotes
 * - Strips Unicode line/paragraph separators (\u2028, \u2029)
 */
export function normalizeText(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return (
    text
      // Replace smart double quotes
      .replace(/[""]/g, '"')
      // Replace smart single quotes
      .replace(/['']/g, "'")
      // Strip Unicode line/paragraph separators
      .replace(/[\u2028\u2029]/g, '')
      // Strip unescaped control characters (preserve \n \r \t)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  );
}
```

- [ ] Step 3: Add `extractJsonBlocks` function after `normalizeText`:

```typescript
/**
 * Extract all balanced JSON blocks from a string.
 * Correctly handles strings, escape sequences, and nested structures.
 */
export function extractJsonBlocks(
  text: string,
  _options: { minSize?: number } = {}
): Array<{ start: number; end: number; text: string; isObject: boolean }> {
  if (!text || typeof text !== 'string') return [];

  const blocks: Array<{ start: number; end: number; text: string; isObject: boolean }> = [];
  let i = 0;

  while (i < text.length) {
    // Find opening bracket
    if (text[i] !== '{' && text[i] !== '[') {
      i++;
      continue;
    }

    const startIdx = i;
    const openChar = text[i];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let stringDelim: string | null = null;
    let isEscaped = false;
    let foundEnd = false;

    while (i < text.length) {
      const ch = text[i];

      if (isEscaped) {
        isEscaped = false;
        i++;
        continue;
      }

      if (ch === '\\' && inString) {
        isEscaped = true;
        i++;
        continue;
      }

      // String delimiter handling
      if ((ch === '"' || ch === "'" || ch === '`') && !inString) {
        inString = true;
        stringDelim = ch;
        i++;
        continue;
      }

      if (ch === stringDelim && inString) {
        inString = false;
        stringDelim = null;
        i++;
        continue;
      }

      if (inString) {
        i++;
        continue;
      }

      // Bracket counting
      if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          foundEnd = true;
          break;
        }
      }

      i++;
    }

    if (foundEnd) {
      const blockText = text.slice(startIdx, i + 1);
      blocks.push({
        start: startIdx,
        end: i,
        text: blockText,
        isObject: openChar === '{',
      });
      i++;
    } else {
      // Unbalanced - move past opening bracket and continue
      i = startIdx + 1;
    }
  }

  return blocks;
}
```

- [ ] Step 4: Add `scrubConcatenation` function after `extractJsonBlocks`:

```typescript
/**
 * Fix string concatenation hallucinations from LLMs.
 * Only runs at Tier 4 (desperation) - applies strict patterns to avoid
 * damaging valid content like mathematical expressions.
 */
export function scrubConcatenation(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // 1. Mid-string concatenation: "text" + "more" -> "textmore"
  // Match both standard (+) and full-width (＋) plus signs
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

  // 2. Multi-line concatenation: "text"\n+\n"more"
  result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(?:\r?\n)+\s*(["'])/g, '$1$2');
  result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(["'])/g, '$1$2');

  // 3. Dangling plus before punctuation: "text" + , -> "text" ,
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*([,}\]])/g, '$1$2');

  // 4. Trailing dangling plus: "text" + -> "text"
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*$/g, '$1');

  return result;
}
```

- [ ] Step 5: Add `stripMarkdownFences` function after `scrubConcatenation`:

```typescript
/**
 * Strip markdown code fences from content.
 * Handles both ``` and ~~~ fences, with or without language specifier.
 */
export function stripMarkdownFences(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const trimmed = text.trim();

  // Complete fences: ```json ... ``` or ~~~json ... ~~~
  const fenceMatch = trimmed.match(/^(?:```|~~~)(?:json)?\s*([\s\S]*?)\s*(?:```|~~~)$/i);
  if (fenceMatch) return fenceMatch[1].trim();

  let result = trimmed;
  // Unclosed opening fence: ```json\n{...}
  result = result.replace(/^(?:```|~~~)(?:json)?\s*/i, '');
  // Orphan closing fence: {...}\n```
  result = result.replace(/\s*(?:```|~~~)\s*$/i, '');

  return result.trim();
}
```

- [ ] Step 6: Add new `stripThinkingTags` function (regex-based from openvault) after `stripMarkdownFences`:

```typescript
/**
 * Strip thinking/reasoning tags from LLM response
 */
export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  return (
    text
      // Paired XML tags: <think>...</think>, <thinking>...</thinking>, etc.
      // (?:\s+[^>]*)? matches optional attributes like <tool_call name="extract_events">
      .replace(
        /<(think|thinking|thought|reasoning|reflection|tool_call|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
        ''
      )
      // Paired bracket tags: [THINK]...[/THINK], [TOOL_CALL]...[/TOOL_CALL], etc.
      .replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
      .replace(/\*thinks?:[\s\S]*?\*/gi, '')
      .replace(/\(thinking:[\s\S]*?\)/gi, '')
      // Orphaned closing tags (opening tag was in assistant prefill)
      .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|tool_call|search)>\s*/i, '')
      // ideal_output: few-shot example wrapper that LLM sometimes reproduces after JSON
      .replace(/<\/ideal_output>\s*/gi, '')
      .trim()
  );
}
```

- [ ] Step 7: Add `safeParseJSON` function with result object return type after `stripThinkingTags`:

```typescript
/**
 * Safely parse JSON with progressive fallback waterfall.
 * Returns Zod-style result object for maximum reusability.
 *
 * Flow:
 *   Input Validation → stripThinkingTags → Strip Fences → Tier 1 (JSON.parse)
 *   → Tier 2 (jsonrepair) → Tier 3 (Normalize + Extract) → Tier 4 (Scrub) → Tier 5 (Failure)
 */
export function safeParseJSON<T>(
  input: unknown,
  options: {
    schema?: z.ZodType<T>;
    minimumBlockSize?: number;
    onError?: (context: { tier: number; originalLength: number; error: Error; sanitizedString?: string }) => void;
  } = {}
): { success: boolean; data?: T; error?: Error; errorContext?: object } {
  const { schema, minimumBlockSize = 50, onError } = options;
  const originalLength = typeof input === 'string' ? input.length : 0;

  // === Tier 0: Input Validation ===
  if (input === null || input === undefined) {
    const error = new Error('Input is null or undefined');
    const context = { tier: 0, originalLength, error };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }

  // Already an object/array - return as-is
  if (typeof input === 'object') {
    const data = input as T;
    if (schema) {
      try {
        return { success: true, data: schema.parse(data) };
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        return { success: false, error, errorContext: { tier: 0, originalLength, error } };
      }
    }
    return { success: true, data };
  }

  // Coerce primitives to string
  let text = String(input);

  // Empty string check
  if (text.trim().length === 0) {
    const error = new Error('Input is empty or whitespace-only');
    const context = { tier: 0, originalLength, error };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }

  // Strip thinking tags FIRST (before any parsing)
  text = stripThinkingTags(text);

  // Strip markdown fences EARLY
  text = stripMarkdownFences(text);

  // === Tier 1: Native Parse ===
  try {
    const parsed = JSON.parse(text);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 2
  }

  // === Tier 2: Extract + JsonRepair ===
  try {
    const blocks = extractJsonBlocks(text);

    if (blocks.length > 0) {
      // Select last substantial block
      const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
      const selectedBlock =
        substantialBlocks.length > 0
          ? substantialBlocks[substantialBlocks.length - 1]
          : blocks[blocks.length - 1];

      const repaired = jsonrepair(selectedBlock.text);
      const parsed = JSON.parse(repaired);
      if (schema) {
        const data = schema.parse(parsed) as T;
        return { success: true, data };
      }
      return { success: true, data: parsed as T };
    }

    // No blocks found - apply jsonrepair to whole text
    const repaired = jsonrepair(text);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 3
  }

  // === Tier 3: Normalize + Extract ===
  try {
    const normalized = normalizeText(text);
    const blocks = extractJsonBlocks(normalized);

    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }

    const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
    const selectedBlock =
      substantialBlocks.length > 0 ? substantialBlocks[substantialBlocks.length - 1] : blocks[blocks.length - 1];

    const repaired = jsonrepair(selectedBlock.text);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 4
  }

  // === Tier 4: Aggressive Scrub ===
  try {
    const normalized = normalizeText(text);
    const blocks = extractJsonBlocks(normalized);

    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }

    const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
    const selectedBlock =
      substantialBlocks.length > 0 ? substantialBlocks[substantialBlocks.length - 1] : blocks[blocks.length - 1];

    const scrubbed = scrubConcatenation(selectedBlock.text);
    const repaired = jsonrepair(scrubbed);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch (e) {
    // === Tier 5: Fatal Failure ===
    const error = new Error(`JSON parse failed at all tiers: ${(e as Error).message}`);
    const context = {
      tier: 5,
      originalLength,
      sanitizedString: text.slice(0, 500),
      error,
    };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }
}
```

- [ ] Step 8: Run tests to verify compilation

Run: `cd C:/projects/EdgeTTS && npm test -- --run src/utils/text.test.ts`
Expected: Tests fail with wrong assertions (expected - we'll fix in Task 2)

- [ ] Step 9: Commit

```bash
cd C:/projects/EdgeTTS && git add -A && git commit -m "refactor: port JSON parsing functions from openvault

- Add normalizeText, extractJsonBlocks, scrubConcatenation, stripMarkdownFences
- Replace stripThinkingTags with regex-based version
- Replace safeParseJSON with 5-tier waterfall returning result object
- Remove stripPairedTag, stripBracketTag, extractBalancedJSON"
```

---

### Task 2: Update tests for result object pattern

**Files:**
- Modify: `src/utils/text.test.ts`

**Common Pitfalls:**
- Remove tests for deleted functions (`stripPairedTag`, `stripBracketTag`, `extractBalancedJSON`)
- All `safeParseJSON` tests now check `result.success` and `result.data`

- [ ] Step 1: Update imports to remove deleted functions:

```typescript
import { stripThinkingTags, extractJsonBlocks, safeParseJSON, normalizeText, stripMarkdownFences, scrubConcatenation } from './text';
```

- [ ] Step 2: Delete the following test sections entirely:
  - `describe('stripPairedTag')`
  - `describe('stripBracketTag')`
  - `describe('extractBalancedJSON')`

- [ ] Step 3: Add tests for new functions before `safeParseJSON` tests:

```typescript
describe('normalizeText', () => {
  it('replaces smart quotes with standard quotes', () => {
    expect(normalizeText('"hello"')).toBe('"hello"');
    expect(normalizeText("'world'")).toBe("'world'");
  });

  it('strips control characters except newline/tab', () => {
    expect(normalizeText('hello\x00world')).toBe('helloworld');
    expect(normalizeText('hello\nworld')).toBe('hello\nworld');
    expect(normalizeText('hello\tworld')).toBe('hello\tworld');
  });

  it('returns non-strings as-is', () => {
    expect(normalizeText(null as any)).toBe(null);
    expect(normalizeText(undefined as any)).toBe(undefined);
  });
});

describe('extractJsonBlocks', () => {
  it('extracts single JSON object', () => {
    const blocks = extractJsonBlocks('text {"a": 1} more');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('{"a": 1}');
    expect(blocks[0].isObject).toBe(true);
  });

  it('extracts multiple blocks and returns all', () => {
    const blocks = extractJsonBlocks('{"a": 1} text [1, 2] more');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('{"a": 1}');
    expect(blocks[1].text).toBe('[1, 2]');
    expect(blocks[1].isObject).toBe(false);
  });

  it('returns empty array for no JSON', () => {
    expect(extractJsonBlocks('no json here')).toEqual([]);
  });
});

describe('stripMarkdownFences', () => {
  it('strips complete fences', () => {
    expect(stripMarkdownFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripMarkdownFences('~~~\n{"a": 1}\n~~~')).toBe('{"a": 1}');
  });

  it('strips orphan fences', () => {
    expect(stripMarkdownFences('```json\n{"a": 1}')).toBe('{"a": 1}');
    expect(stripMarkdownFences('{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('returns text as-is if no fences', () => {
    expect(stripMarkdownFences('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('scrubConcatenation', () => {
  it('removes mid-string concatenation', () => {
    expect(scrubConcatenation('"hello" + "world"')).toBe('"helloworld"');
  });

  it('handles full-width plus', () => {
    expect(scrubConcatenation('"hello" ＋ "world"')).toBe('"helloworld"');
  });

  it('removes dangling plus before punctuation', () => {
    expect(scrubConcatenation('"text" + ,')).toBe('"text" ,');
  });
});
```

- [ ] Step 4: Update all `safeParseJSON` tests to use result object pattern. Replace existing `safeParseJSON` describe block with:

```typescript
describe('safeParseJSON', () => {
  const SimpleSchema = z.object({ value: z.string() });
  const NumberSchema = z.object({ count: z.number() });

  it('parses valid JSON', () => {
    const result = safeParseJSON('{"value": "hello"}', { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('strips thinking tags before parsing', () => {
    const input = `<thinking>let me think</thinking>{"value": "hello"}`;
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('strips markdown fences before parsing', () => {
    const input = '```json\n{"value": "hello"}\n```';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('handles string concatenation hallucinations at Tier 4', () => {
    const input = '{"value": "hello" + "world"}';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('helloworld');
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'some text {"value": "hello"} more text';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('returns error result for invalid JSON', () => {
    const result = safeParseJSON('not json at all', { schema: SimpleSchema });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns error result for schema mismatch', () => {
    const result = safeParseJSON('{"count": "not-a-number"}', { schema: NumberSchema });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('handles orphaned closing tags', () => {
    const input = '</thinking>{"value": "hello"}';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('works without schema (returns unknown)', () => {
    const result = safeParseJSON('{"any": "data"}');
    expect(result.success).toBe(true);
    expect((result.data as any).any).toBe('data');
  });
});
```

- [ ] Step 5: Run tests to verify they pass

Run: `cd C:/projects/EdgeTTS && npm test -- --run src/utils/text.test.ts`
Expected: All tests pass

- [ ] Step 6: Commit

```bash
cd C:/projects/EdgeTTS && git add -A && git commit -m "test: update tests for result object pattern in safeParseJSON

- Add tests for normalizeText, extractJsonBlocks, stripMarkdownFences, scrubConcatenation
- Remove tests for deleted functions
- Update safeParseJSON tests to check result.success and result.data"
```

---

### Task 3: Update LLMApiClient caller

**Files:**
- Modify: `src/services/llm/LLMApiClient.ts`

**Common Pitfalls:**
- Keep `RetriableError` for compatibility with `withRetry`
- Schema is now passed in options object

- [ ] Step 1: Update the `safeParseJSON` call in `callStructured` method. Find this line:

```typescript
return safeParseJSON(content, schema);
```

Replace with:

```typescript
const result = safeParseJSON(content, { schema });
if (!result.success) {
  throw new RetriableError(`JSON parse failed: ${result.error!.message}`);
}
return result.data;
```

- [ ] Step 2: Run tests to verify no regressions

Run: `cd C:/projects/EdgeTTS && npm test -- --run`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
cd C:/projects/EdgeTTS && git add -A && git commit -m "refactor: update LLMApiClient for result object pattern

- Check result.success and throw RetriableError on failure
- Pass schema in options object"
```

---

### Task 4: Update documentation

**Files:**
- Modify: `src/services/llm/CLAUDE.md`

- [ ] Step 1: Update the JSON Repair Pipeline section. Find:

```markdown
## JSON Repair Pipeline

**Location**: `src/utils/text.ts`

`safeParseJSON<T>(input, schema)` applies multi-stage repair:
1. Strip thinking/reasoning tags using **index-based extraction** (not regex) to prevent catastrophic backtracking
   - Paired tags: `stripPairedTag()` handles `<think>`, `[THINK]`, `*thinks*`, etc.)
2. Strip markdown code fences
3. Extract last balanced JSON block (dodges `<tool_call>` hallucinations)
4. Sanitize LLM syntax hallucinations (string concatenation `+`, dangling plus)
5. Pad truncated outputs (odd quote count detection)
6. `jsonrepair` library for structural fixes
7. Zod schema validation

Used by `LLMApiClient.callStructured()` instead of native parsing.
```

Replace with:

```markdown
## JSON Repair Pipeline

**Location**: `src/utils/text.ts`

`safeParseJSON<T>(input, options)` applies 5-tier waterfall repair:

| Tier | Strategy |
|------|----------|
| 0 | Input validation (null, empty, already object) |
| 1 | Native `JSON.parse` |
| 2 | `extractJsonBlocks` + `jsonrepair` |
| 3 | `normalizeText` + `extractJsonBlocks` + `jsonrepair` |
| 4 | Aggressive `scrubConcatenation` + `jsonrepair` |
| 5 | Failure (return error result) |

Returns `{success, data?, error?}` result object. Caller throws `RetriableError` on failure.

**Key functions:**
- `normalizeText` — Fix smart quotes, control characters
- `extractJsonBlocks` — Extract ALL balanced blocks (not just last)
- `scrubConcatenation` — Fix LLM string `+` hallucinations
- `stripThinkingTags` — Strip `<think>`, `[THINK]`, etc. (regex-based)
- `stripMarkdownFences` — Strip ``` and ~~~ fences
```

- [ ] Step 2: Commit

```bash
cd C:/projects/EdgeTTS && git add -A && git commit -m "docs: update CLAUDE.md for new JSON parsing pipeline

- Document 5-tier waterfall
- List key functions and their purposes
- Note result object return type"
```

---

### Task 5: Final verification

- [ ] Step 1: Run full test suite

Run: `cd C:/projects/EdgeTTS && npm test -- --run`
Expected: All tests pass

- [ ] Step 2: Verify TypeScript compilation

Run: `cd C:/projects/EdgeTTS && npx tsc --noEmit`
Expected: No errors

- [ ] Step 3: Final commit if any changes

```bash
cd C:/projects/EdgeTTS && git add -A && git commit -m "chore: final cleanup after JSON parsing refactor" || echo "No changes to commit"
```