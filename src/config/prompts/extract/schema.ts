// src/config/prompts/extract/schema.ts
// Pipeline stage 1 of 3: Extract → Merge → Assign

export const EXTRACT_SCHEMA_TEXT = `{
  "reasoning": "Short step-by-step thinking here (or null)",
  "characters": [
    {
      "canonicalName": "Best Name",
      "variations": ["Best Name", "Other Name", "Title"],
      "gender": "male"
    }
  ]
}`;
