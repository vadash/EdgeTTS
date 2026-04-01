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
