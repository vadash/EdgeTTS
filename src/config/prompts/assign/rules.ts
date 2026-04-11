// src/config/prompts/assign/rules.ts
// Pipeline stage 3 of 3: Extract -> Merge -> Assign

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

8. MIXED PARAGRAPHS (DIALOGUE + NARRATION):
   A paragraph that contains ANY dialogue with a clear speaker belongs to that speaker -- even if most of the paragraph is narration describing actions, scenery, or backstory after the quote.
   The speaker is determined by the dialogue portion (speech verb, action beat, pronoun). The narration tail does NOT change the speaker.
   Example: "Observe," Professor Viridian said. He put on a gauntlet and reached through the barrier to pluck a leaf. -> Assign to Professor Viridian (he is the one who spoke "Observe").

Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
Shorthand: "N: code" for assignments, "narr" for narration-only, "voc" for vocative traps.`;
