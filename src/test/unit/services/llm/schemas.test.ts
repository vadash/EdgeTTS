import { describe, expect, it } from "vitest";
import { ExtractSchema, MergeSchema, AssignSchema } from "@/services/llm/schemas";

describe("Schema strictness removal", () => {
  it("ExtractSchema should accept extra keys without rejecting", () => {
    const result = ExtractSchema.safeParse({
      reasoning: null,
      characters: [{
        canonicalName: "Test",
        variations: ["test"],
        gender: "unknown"
      }],
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
});
