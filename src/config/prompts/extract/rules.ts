// src/config/prompts/extract/rules.ts
// Pipeline stage 1 of 3: Extract -> Merge -> Assign

export const EXTRACT_RULES = `1. HOW TO FIND SPEECH:
   - Look for quotes: "Hello", 'Hi', <<Привет>>, „Hallo"
   - Look for game system messages in brackets: [Level Up!], [Quest]
   - Look for telepathy in angle brackets: <Can you hear me?>
   - Look for thoughts in asterisks: *I must run*

2. HOW TO FIND THE SPEAKER:
   - Look for speech verbs near the quotes: said, asked, shouted, replied. Example: "Hi," John said. -> Speaker is John.
   - Look for actions near the quotes. Example: Sarah nodded. "Yes." -> Speaker is Sarah.
   - First-person narrator: If the text says "I said" or "I asked", the speaker is "Protagonist".
   - System messages: If the text is [Level Up!], the speaker is "System".

3. WHO NOT TO EXTRACT (CRITICAL):
   - Do NOT extract a character if they are only mentioned by someone else.
   - Do NOT extract a character if their name is inside the quotes (Vocative).
     Example: "John, come here!" said Mary. -> Mary is the speaker. John is just listening. Do NOT extract John based on this sentence.
   - Do NOT extract sound effects like [Bang!] or [Sigh].
   - DO extract characters who make non-verbal vocalizations (e.g., grunts, screams, sighs, "eep", "hmm") IF it serves as a response or communication.
   - Do NOT extract purely environmental sound effects (e.g., [Bang!], *Crash*).
   - THOUGHTS: When a character has thoughts (e.g., *I must run*), extract them as speaking and assign to that character. Thoughts use the SAME voice profile as spoken dialogue.
     Example: "John pondered. *I should leave.*" -> Extract John, assign the thought to John.
   - GROUPS: If a group of people speak in unison (e.g., "the crowd", "the guards"), extract them as a single entity with gender "unknown".
     Example: "Kill the monster!" the crowd chanted. -> Extract "The Crowd", gender "unknown".

4. HOW TO FORMAT NAMES AND GENDER:
   - "canonicalName": The best, most complete name you can find (e.g., "Queen Elizabeth", "John Smith", "System", "Protagonist").
   - "variations": An array of ALL names used for this person (e.g., ["John Smith", "John", "Mr. Smith"]). MUST include the canonicalName itself!
   - "gender": MUST be exactly one of these three English words: "male", "female", or "unknown".
     * If pronouns are he/him/his -> "male"
     * If pronouns are she/her/hers -> "female"
     * "System" is always -> "female"
     * If absolutely no clue -> "unknown"
     * NEVER translate the gender words.

5. MERGING VARIATIONS:
   - If "The Dark Lord" and "Azaroth" are clearly the exact same person speaking, put both in the "variations" array of one character.

6. AGGRESSIVE CHARACTER EXTRACTION:
   - CRITICAL: Extract EVERY named character who speaks, even mentors, shopkeepers, or background characters.
   - Do NOT ignore secondary characters who speak frequently to the protagonist.
   - If they have dialogue, they MUST be extracted.
   - CRITICAL: Extract EVERY named character who speaks, even mentors, shopkeepers, or background characters. If they have dialogue, they MUST be extracted.

Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
Shorthand: "N: speaker(code)" for found characters, "voc" for vocatives to skip.`;
