// src/config/prompts/assign/rules.ts
// Pipeline stage 3 of 3: Extract → Merge → Assign

export const ASSIGN_RULES = `1. SKIP NON-DIALOGUE:
   If a paragraph is just narration and NO ONE is speaking or thinking, IGNORE IT. Do not put its number in the JSON.

2. SYSTEM MESSAGES = SYSTEM:
   If the text is a game message in brackets like [Level Up!], assign it to the System code.

3. EXPLICIT TAGS (EASIEST):
   Look for "said X", "asked Y".
   Example: "Hello," said John. -> Assign to John's code.
   Example: "Hi," he said. -> Look at who "he" is based on the previous sentences.

4. ACTION BEATS:
   If a character does an action right before/after the quote, they are the speaker.
   Example: Mary smiled. "Welcome." -> Assign to Mary's code.

5. VOCATIVE TRAP (WARNING):
   A name INSIDE the quotes is usually the person being spoken TO, not the speaker!
   Example: "John, run!" -> John is NOT speaking. The other person in the scene is speaking.

6. FIRST PERSON:
   If the text says "I said", assign it to the "Protagonist" code.

7. NEGATIVE INDICES ARE READ-ONLY:
   Paragraphs labeled with negative indices inside the previous context block are from the previous section for context only. Do NOT assign speaker codes to them.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
CRITICAL: Keep reasoning extremely concise. Do not quote full sentences. Do not analyze every paragraph individually. Only briefly note ambiguous cases.
Follow these steps IN ORDER:

Step 1: Dialogue scan — Identify every paragraph with quotes, thoughts, or system bracket messages.
Step 2: Speaker match — Use speech verbs ("said X"), action beats, pronouns, and first-person narration to identify speakers.
Step 3: Vocative check — Names inside quotes are listeners, not speakers. Cross them off.
Step 4: Context check — Use paragraph sequence and previous context (negative indices) for ambiguous cases.
Step 5: Output — Map paragraph numbers to speaker codes. Skip pure narration. Only assign non-negative indices.`;
