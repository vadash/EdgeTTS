import { describe, expect, it } from "vitest";
import { z } from "zod";
import { safeParseJSON, stripThinkingTags } from "../../../utils/text";

describe("safeParseJSON array-at-root recovery", () => {
  const TestSchema = z.object({
    reasoning: z.string().nullable().default(null),
    items: z.array(z.string())
  });

  it("should wrap naked array as {reasoning: null, items: [...]}", () => {
    const json = '["a", "b", "c"]';
    const result = safeParseJSON(json, { schema: TestSchema });
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
    const result = safeParseJSON(json, { schema: TestSchema });
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
    const result = safeParseJSON(json, { schema: NoArraySchema });
    // Should fail validation since we can't map array to any field
    expect(result.success).toBe(false);
  });
});

describe("safeParseJSON flattened assignments recovery", () => {
  const AssignSchema = z.object({
    reasoning: z.string().nullable().default(null),
    assignments: z.record(z.string(), z.string())
  });

  it("should wrap flattened numeric-key object as {reasoning: null, assignments: {...}}", () => {
    const json = '{"0": "A", "1": "B", "2": "A"}';
    const result = safeParseJSON(json, { schema: AssignSchema });
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
    const result = safeParseJSON(json, { schema: AssignSchema });
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
    const result = safeParseJSON(json, { schema: AssignSchema });
    // Should fail - no recognized keys and not numeric
    expect(result.success).toBe(false);
  });
});

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

  it("should still strip<think> tags", () => {
    const input = '<think>{"key": "value"}</think>';
    const result = stripThinkingTags(input);
    expect(result).toBe('');
  });
});

import { ExtractSchema, MergeSchema, AssignSchema } from "../../../services/llm/schemas";

describe("safeParseJSON with real schemas", () => {
  it("should recover ExtractSchema from naked array", () => {
    const json = '[{"canonicalName": "John", "variations": ["Johnny"], "gender": "male"}]';
    const result = safeParseJSON(json, { schema: ExtractSchema });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull();
      expect(result.data.characters).toHaveLength(1);
      expect(result.data.characters[0].canonicalName).toBe("John");
    }
  });

  it("should recover MergeSchema from naked array", () => {
    const json = '[[0, 1], [2, 3]]';
    const result = safeParseJSON(json, { schema: MergeSchema });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull();
      expect(result.data.merges).toHaveLength(2);
      expect(result.data.merges[0]).toEqual([0, 1]);
    }
  });

  it("should recover AssignSchema from flattened assignments", () => {
    const json = '{"0": "Narrator", "1": "Alice", "2": "Bob"}';
    const result = safeParseJSON(json, { schema: AssignSchema });
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
    const json = '{"reasonin": "some thought", "characters": [{"canonicalName": "Test", "variations": [], "gender": "unknown"}]}';
    const result = safeParseJSON(json, { schema: ExtractSchema });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasoning).toBeNull(); // defaulted
      expect(result.data.characters).toHaveLength(1);
    }
  });
});
