// src/config/prompts/merge/schema.ts
// Pipeline stage 2 of 3: Extract -> Merge -> Assign

export const MERGE_SCHEMA_TEXT = `{
  "reasoning": "Short thinking about who is the same person (or null)",
  "merges": [
    [KEEP_ID, ABSORB_ID],
    [KEEP_ID, ABSORB_ID, ABSORB_ID2]
  ]
}

CRITICAL FORMAT RULES:
- "merges" is a list of lists of numbers.
- Every inner list MUST have at least 2 numbers. Single numbers are INVALID.
- If no characters should be merged, return an empty array: "merges": []
- DO NOT invent numbers. Only use the index numbers provided in the input.`;
