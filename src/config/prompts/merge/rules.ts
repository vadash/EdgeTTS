// src/config/prompts/merge/rules.ts
// Pipeline stage 2 of 3: Extract -> Merge -> Assign

export const MERGE_RULES = `1. CHECK VARIATIONS AND CONTEXT:
   If Character A and Character B share a name in their variations, MERGE them.
   If they do not share an exact name, but context clearly proves they are the same entity (e.g., "The Purple Man" and "The Registrar" in the same scene), MERGE them.
   Example: 0 has ["Marcus", "Marc"], 1 has ["Marcus Stone", "Marcus"]. They both have "Marcus". -> MERGE [1, 0].

2. PROTAGONIST LINKING:
   If one character is "Protagonist" and another is clearly the main character of the story (same gender/context), MERGE them.

3. SYSTEM LINKING:
   "System", "Interface", "Blue Box", "Notification" are all the same game system. -> MERGE them.

4. DIFFERENT PEOPLE (DO NOT MERGE):
   - If one is "male" and the other is "female", DO NOT MERGE. They are different people.
   - "The King" and "The Prince" are different roles. DO NOT MERGE.
   - "John" and "John's Father" are different people. DO NOT MERGE.
   - If you are not 100% sure, DO NOT MERGE.

5. HOW TO ORDER THE MERGE GROUP:
   A merge group must have AT LEAST 2 numbers.
   The FIRST number in the group must be the character's ACTUAL PROPER NAME (e.g., "Irogh", "Bacci").
   Proper nouns ALWAYS beat descriptive titles (e.g., "The Purple Man", "The Most Handsome Man"), even if the descriptor is longer.
   If no proper name exists, use the most descriptive title.
   Example: 0 is "Irogh". 1 is "The Most Handsome Man". The group should be [0, 1] because "Irogh" is the proper name.

Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
Shorthand: "X+Y→X" for merges, "uniq" for no-match characters, "sys" for system entities.`;
