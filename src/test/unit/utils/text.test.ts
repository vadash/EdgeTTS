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
