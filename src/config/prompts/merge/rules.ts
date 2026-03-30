// src/config/prompts/merge/rules.ts
// Pipeline stage 2 of 3: Extract -> Merge -> Assign

export const MERGE_RULES = `1. CHECK VARIATIONS:
   Look at the "variations" arrays. If Character A and Character B share a name in their variations, they are the same person.
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
   The FIRST number in the group must be the character with the longest, most complete, or best "canonicalName".
   Example: 0 is "Bob". 1 is "Robert Smith". The group should be [1, 0] because "Robert Smith" is better.
   Example: 3 is "System". 5 is "Interface". The group should be [3, 5] because "System" is the best name for game menus.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
CRITICAL: Keep reasoning extremely concise. Only list characters that have potential merges; skip obviously unrelated pairs.
Follow these steps IN ORDER:

Step 1: Variation cross-check -- Compare variations arrays between all character pairs. Flag any shared names.
Step 2: System entity match -- Link System, Interface, Blue Box, Notification into one group.
Step 3: Protagonist match -- If Protagonist exists, check if another character is the same person (main character).
Step 4: Conflict check -- Reject any proposed merges with gender mismatches or insufficient confidence.
Step 5: Output -- Build merge groups. First number = best/longest canonicalName. Empty array if no merges.`;
