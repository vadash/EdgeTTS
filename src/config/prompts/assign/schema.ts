// src/config/prompts/assign/schema.ts
// Pipeline stage 3 of 3: Extract -> Merge -> Assign

export const ASSIGN_SCHEMA_TEXT = `{
  "reasoning": "Short explanation (or null)",
  "assignments": {
    "PARAGRAPH_NUMBER": "SPEAKER_CODE",
    "PARAGRAPH_NUMBER": "SPEAKER_CODE"
  }
}

CRITICAL FORMAT RULES:
- The keys in "assignments" MUST be the exact paragraph numbers (as strings, e.g., "0", "1", "4").
- The values MUST be the Speaker Letter Codes (e.g., "A", "B", "C"). NEVER use the character's full name.
- ONLY include paragraph numbers that actually have dialogue, thoughts, or system messages. Omit narration paragraphs entirely.`;
