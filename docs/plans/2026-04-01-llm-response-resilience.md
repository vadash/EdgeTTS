# LLM Response Resilience Fixes Implementation Plan

**Goal:** Fix four common LLM response parsing failures (key typos, naked arrays, flattened assignments, XML wrappers) by relaxing schema strictness and adding recovery logic.

**Architecture:** Two-file change: remove `.strict()` from Zod schemas to allow key typos to default through, and enhance `safeParseJSON()` with schema-aware recovery for structural mismatches plus expanded tag stripping.

**Tech Stack:** TypeScript, Zod 4, Vitest for testing

---

### File Structure Overview

- **Modify:** `src/services/llm/schemas.ts` - Remove `.strict()` from 4 Zod schemas
- **Modify:** `src/utils/text.ts` - Add recovery logic to `safeParseJSON()` and expand tag stripping patterns
- **Test:** `src/test/unit/utils/text.test.ts` - Add tests for recovery paths
- **Test:** `src/test/unit/services/llm/schemas.test.ts` - Verify schemas no longer reject extra keys

---

### Task 1: Remove `.strict()` from Schemas

**Files:**
- Modify: `src/services/llm/schemas.ts`
- Test: `src/test/unit/services/llm/schemas.test.ts`

- [ ] Step 1: Write the failing test

Create `src/test/unit/services/llm/schemas.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ExtractSchema, MergeSchema, AssignSchema, QaSchema } from "../../../services/llm/schemas";

describe("Schema strictness removal", () => {
  it("ExtractSchema should accept extra keys without rejecting", () => {
    const result = ExtractSchema.safeParse({
      reasoning: null,
      characters: [],
      extraKey: "should be allowed"
    });
    expect(result.success).toBe(true);
  });

  it("MergeSchema should accept extra keys without rejecting", () => {
    const result = MergeSchema.safeParse({
      reasoning: null,
      merges: [],
      extraKey: "should be allowed"
    });
    expect(result.success).toBe(true);
  });

  it("AssignSchema should accept extra keys without rejecting", () => {
    const result = AssignSchema.safeParse({
      reasoning: null,
      assignments: {},
      extraKey: "should be allowed"
    });
    expect(result.success).toBe(true);
  });

  it("QaSchema should accept extra keys without rejecting", () => {
    const result = QaSchema.safeParse({
      reasoning: null,
      corrections: [],
      extraKey: "should be allowed"
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/test/unit/services/llm/schemas.test.ts`

Expected: FAIL - tests fail because schemas currently have `.strict()` which rejects extra keys

- [ ] Step 3: Remove `.strict()` from schemas

Edit `src/services/llm/schemas.ts`:

Remove `.strict()` from the end of each schema definition:
- `ExtractSchema`
- `MergeSchema`
- `AssignSchema`
- `QaSchema`

The schemas should change from:
```typescript
export const ExtractSchema = z.object({...}).strict();
```
to:
```typescript
export const ExtractSchema = z.object({...});
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/test/unit/services/llm/schemas.test.ts`

Expected: PASS - all 4 tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: remove .strict() from Zod schemas to allow extra keys"
```

---

### Task 2: Add Array-at-Root Recovery to safeParseJSON

**Files:**
- Modify: `src/utils/text.ts`
- Test: `src/test/unit/utils/text.test.ts`

**Common Pitfalls:**
- Need to detect if Zod schema has a specific shape property (use schema.shape)
- Zod arrays have `.element` property, objects have `.shape` property
- Must check if parsed value is array AND schema expects object with array field

- [ ] Step 1: Write the failing test

Add to existing `src/test/unit/utils/text.test.ts` (or create if doesn't exist):

```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { safeParseJSON } from "../../../utils/text";

describe("safeParseJSON array-at-root recovery", () => {
  const TestSchema = z.object({
    reasoning: z.string().nullable().default(null),
    items: z.array(z.string())
  });

  it("should wrap naked array as {reasoning: null, items: [...]}", () => {
    const json = '["a", "b", "c"]';
    const result = safeParseJSON(json, TestSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        reasoning: null,
        items: ["a", "b", "c"]
      });
    }
  });

  it("should not wrap if result is already an object", () => {
    const json = '{"reasoning": "test", "items": ["a"]}';
    const result = safeParseJSON(json, TestSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        reasoning: "test",
        items: ["a"]
      });
    }
  });

  it("should fail normally if schema has no array field", () => {
    const NoArraySchema = z.object({
      reasoning: z.string().nullable().default(null),
      name: z.string()
    });
    const json = '["a", "b"]'; // Array but no array field in schema
    const result = safeParseJSON(json, NoArraySchema);
    // Should fail validation since we can't map array to any field
    expect(result.success).toBe(false);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/test/unit/utils/text.test.ts -t "array-at-root recovery"`

Expected: FAIL - array wrapping not yet implemented, naked array fails schema validation

- [ ] Step 3: Implement array-at-root recovery

Edit `src/utils/text.ts` in the `safeParseJSON` function, after `jsonrepair` but before `schema.parse()`:

Add logic to detect when:
1. Parsed result is an array
2. Schema is a ZodObject with a shape property
3. Schema has exactly one field that accepts an array (ZodArray)

Then wrap: `{ reasoning: null, [fieldName]: parsedArray }`

Implementation pattern:
```typescript
// After jsonrepair, before schema.parse(parsed)
if (Array.isArray(parsed) && schema._def?.shape) {
  const shape = schema._def.shape;
  const arrayFields = Object.entries(shape).filter(
    ([_, fieldSchema]) => fieldSchema._def?.typeName === "ZodArray"
  );
  if (arrayFields.length === 1) {
    const [fieldName] = arrayFields[0];
    parsed = { reasoning: null, [fieldName]: parsed };
  }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/test/unit/utils/text.test.ts -t "array-at-root recovery"`

Expected: PASS - all 3 tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: add array-at-root recovery to safeParseJSON"
```

---

### Task 3: Add Flattened Assignments Recovery

**Files:**
- Modify: `src/utils/text.ts`
- Test: `src/test/unit/utils/text.test.ts`

**Common Pitfalls:**
- Must check for numeric-string keys like "0", "1", "2"
- Must verify NO recognized top-level keys are present (reasoning, assignments, characters, merges)
- Must only apply to objects that look like flattened assignment dicts

- [ ] Step 1: Write the failing test

Add to `src/test/unit/utils/text.test.ts`:

```typescript
describe("safeParseJSON flattened assignments recovery", () => {
  const AssignSchema = z.object({
    reasoning: z.string().nullable().default(null),
    assignments: z.record(z.string())
  });

  it("should wrap flattened numeric-key object as {reasoning: null, assignments: {...}}", () => {
    const json = '{"0": "A", "1": "B", "2": "A"}';
    const result = safeParseJSON(json, AssignSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        reasoning: null,
        assignments: { "0": "A", "1": "B", "2": "A" }
      });
    }
  });

  it("should not wrap if object has recognized keys", () => {
    const json = '{"reasoning": "test", "assignments": {"0": "A"}}';
    const result = safeParseJSON(json, AssignSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        reasoning: "test",
        assignments: { "0": "A" }
      });
    }
  });

  it("should not wrap if keys are not numeric strings", () => {
    const json = '{"foo": "A", "bar": "B"}';
    const result = safeParseJSON(json, AssignSchema);
    // Should fail - no recognized keys and not numeric
    expect(result.success).toBe(false);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/test/unit/utils/text.test.ts -t "flattened assignments recovery"`

Expected: FAIL - flattened dict wrapping not yet implemented

- [ ] Step 3: Implement flattened assignments recovery

Edit `src/utils/text.ts` in `safeParseJSON`, after the array recovery:

Add logic to detect when:
1. Parsed result is a plain object
2. Object has NO recognized keys: reasoning, assignments, characters, merges
3. ALL keys match numeric-string pattern (/^\d+$/)

Then wrap: `{ reasoning: null, assignments: parsed }`

Implementation pattern:
```typescript
// After array recovery, before schema.parse(parsed)
if (
  typeof parsed === "object" &&
  parsed !== null &&
  !Array.isArray(parsed)
) {
  const recognizedKeys = ["reasoning", "assignments", "characters", "merges"];
  const hasRecognizedKey = recognizedKeys.some(key => key in parsed);
  const keys = Object.keys(parsed);
  const allNumeric = keys.length > 0 && keys.every(key => /^\d+$/.test(key));

  if (!hasRecognizedKey && allNumeric) {
    parsed = { reasoning: null, assignments: parsed };
  }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/test/unit/utils/text.test.ts -t "flattened assignments recovery"`

Expected: PASS - all 3 tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: add flattened assignments recovery to safeParseJSON"
```

---

### Task 4: Expand Tag Stripping Patterns

**Files:**
- Modify: `src/utils/text.ts`
- Test: `src/test/unit/utils/text.test.ts`

**Common Pitfalls:**
- The `<arg_key>` tag should be STRIPPED entirely, not unwrapped like `<arg_value>`
- Need to update existing regex to match both `tool_call` and `json_tool_call`
- XML tags can have attributes like `<json_tool_call something="value">`

- [ ] Step 1: Write the failing test

Add to `src/test/unit/utils/text.test.ts`:

```typescript
describe("stripThinkingTags expanded patterns", () => {
  it("should strip <json_tool_call> tags", () => {
    const input = '<json_tool_call>{"key": "value"}</json_tool_call>';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"key": "value"}');
  });

  it("should strip <json_tool_call> with attributes", () => {
    const input = '<json_tool_call name="test">{"key": "value"}</json_tool_call>';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"key": "value"}');
  });

  it("should strip <arg_key> tags entirely", () => {
    const input = '<arg_key>someKey</arg_key>{"key": "value"}';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"key": "value"}');
  });

  it("should strip <arg_key> with content", () => {
    const input = '{"data": "<arg_key>content</arg_key>value"}';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"data": "value"}');
  });

  it("should still unwrap <arg_value> tags", () => {
    const input = '{"key": "<arg_value>{"nested": "obj"}</arg_value>"}';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"key": "{"nested": "obj"}"}');
  });

  it("should still strip <tool_call> tags", () => {
    const input = '<tool_call>{"key": "value"}</tool_call>';
    const result = stripThinkingTags(input);
    expect(result).toBe('{"key": "value"}');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/test/unit/utils/text.test.ts -t "stripThinkingTags expanded patterns"`

Expected: FAIL - `<json_tool_call>` and `<arg_key>` patterns not yet handled

- [ ] Step 3: Expand tag stripping patterns

Edit `src/utils/text.ts` in `stripThinkingTags` function:

Update existing `tool_call` regex to match both variants:
- Change `<tool_call` to `<(?:json_)?tool_call`
- Change `</tool_call>` to `</(?:json_)?tool_call>`
- Change orphan `<tool_call[^>]*>` to `<(?:json_)?tool_call[^>]*>`

Add new pattern for `<arg_key>`:
- Strip entirely: `/<arg_key[^>]*>[\s\S]*?<\/arg_key>/gi`

Implementation pattern (in the regex section):
```typescript
// Update existing tool_call patterns to match json_tool_call too
content = content.replace(/<(?:json_)?tool_call(?:\s+[^>]*)?>([\s\S]*?)<\/(?:json_)?tool_call>/gi, "$1");
content = content.replace(/<(?:json_)?tool_call[^>]*>/gi, "");

// Add arg_key stripping (entirely removed)
content = content.replace(/<arg_key[^>]*>[\s\S]*?<\/arg_key>/gi, "");

// Keep existing arg_value unwrapping
content = content.replace(/<arg_value>([\s\S]*?)<\/arg_value>/gi, "$1");
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/test/unit/utils/text.test.ts -t "stripThinkingTags expanded patterns"`

Expected: PASS - all 6 tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat: expand stripThinkingTags to handle json_tool_call and arg_key"
```

---

### Task 5: Integration Test - Real Schema Recovery

**Files:**
- Test: `src/test/unit/utils/text.test.ts`

- [ ] Step 1: Write integration tests with real schemas

Add to `src/test/unit/utils/text.test.ts`:

```typescript
import { ExtractSchema, MergeSchema, AssignSchema } from "../../../services/llm/schemas";

describe("safeParseJSON with real schemas", () => {
  it("should recover ExtractSchema from naked array", () => {
    const json = '[{"canonicalName": "John", "aliases": ["Johnny"]}]';
    const result = safeParseJSON(json, ExtractSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull();
      expect(result.data.characters).toHaveLength(1);
      expect(result.data.characters[0].canonicalName).toBe("John");
    }
  });

  it("should recover MergeSchema from naked array", () => {
    const json = '[{"keep": "Alice", "discard": "Alicia"}]';
    const result = safeParseJSON(json, MergeSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull();
      expect(result.data.merges).toHaveLength(1);
      expect(result.data.merges[0].keep).toBe("Alice");
    }
  });

  it("should recover AssignSchema from flattened assignments", () => {
    const json = '{"0": "Narrator", "1": "Alice", "2": "Bob"}';
    const result = safeParseJSON(json, AssignSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull();
      expect(result.data.assignments).toEqual({
        "0": "Narrator",
        "1": "Alice",
        "2": "Bob"
      });
    }
  });

  it("should accept key typo and default reasoning to null", () => {
    // Schema no longer has .strict(), so "reasonin" typo is ignored
    const json = '{"reasonin": "some thought", "characters": []}';
    const result = safeParseJSON(json, ExtractSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull(); // defaulted
      expect(result.data.characters).toEqual([]);
    }
  });
});
```

- [ ] Step 2: Run test to verify it passes

Run: `npm test -- src/test/unit/utils/text.test.ts -t "safeParseJSON with real schemas"`

Expected: PASS - all 4 integration tests pass, validating the complete fix

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test: add integration tests for LLM response resilience fixes"
```

---

### Task 6: Run Full Test Suite

**Files:**
- None (verification only)

- [ ] Step 1: Run unit tests

Run: `npm test`

Expected: All unit tests pass (including new tests)

- [ ] Step 2: Run type checking

Run: `npm run typecheck`

Expected: No TypeScript errors

- [ ] Step 3: Run linting

Run: `npm run lint`

Expected: No lint errors

- [ ] Step 4: Commit if all checks pass

```bash
git add -A && git commit -m "chore: verify all checks pass for LLM resilience fixes"
```

---

## Summary

This plan implements 3 design fixes across 2 files:

1. **Remove `.strict()` from schemas** - Allows key typos to be ignored, `reasoning` defaults to null
2. **Add recovery logic to `safeParseJSON`** - Wraps naked arrays and flattened assignments
3. **Expand tag stripping** - Handles `json_tool_call` and strips `arg_key` tags

All changes are backward-compatible and only add resilience for malformed LLM responses.
