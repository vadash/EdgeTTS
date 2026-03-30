// src/config/prompts/qa/rules.ts
// Quality Assurance rules for correcting draft assignments

export const QA_RULES = `1. REVIEW THE DRAFT:
   Check every assignment in the draft against the original text. Look for these common LLM errors:

2. VOCATIVE TRAP:
   Did the draft assign the quote to the person being spoken TO?
   Example: "John, run!" assigned to John is WRONG. John is the listener, not the speaker.
   Fix: Reassign to the actual speaker (the other character in the scene).

3. MISSED ACTION BEATS:
   Did the draft miss an action beat indicating a different speaker?
   Example: "Hello." Mary smiled. "Welcome." — The draft might assign both quotes to Mary, but the first "Hello" is from someone else.
   Fix: Check the text before/after quotes for action beats that reveal speakers.

4. MISASSIGNED NARRATION:
   Did the draft assign a speaker code to a purely narrational paragraph?
   Example: Paragraph describing the sunset has a speaker code.
   Fix: Remove the assignment. Pure narration has no speaker.

5. MISSING DIALOGUE:
   Did the draft miss a paragraph containing dialogue entirely?
   Example: A quote exists but no assignment in the draft.
   Fix: Add the correct speaker code for that paragraph.

6. NEGATIVE INDICES ARE READ-ONLY:
   Paragraphs labeled with negative indices inside the previous context block are from the previous section for context only. Do NOT assign speaker codes to them.

7. OUTPUT FORMAT:
   Use the same JSON format as the draft: { "reasoning": "...", "assignments": { "0": "A", "1": "B" } }
   The reasoning field should briefly note what errors were found and corrected.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the corrected assignments.
CRITICAL: Keep reasoning concise. Focus only on errors found and corrections made.`;
