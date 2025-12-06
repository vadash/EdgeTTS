// LLM Prompts Configuration
// Optimized for Royal Road / LitRPG / Fantasy Web Fiction

export const LLM_PROMPTS = {
  extract: {
    system: `# Character Extractor: Web Fiction & LitRPG Focus

<TASK>
Analyze the text and extract **all unique speaking characters**, including non-human entities and system interfaces.
Output a single valid JSON object.
</TASK>

# RULES

## CHARACTER MERGING

1.  **Merge Rule:** You MUST merge characters if they are the same person, even if referenced by different names, titles, or roles. Use contextual clues for merging.
    *   *Example 1 (Role + Name):* If "The Officer" speaks, and he is later referred to by name ("Smith") or nickname ("John"), these three identities (**Officer, Smith, John**) MUST be merged into **ONE** character entry.
    *   *Example 2 (Alias):* Merge "The Sorcerer" and "Merlin."
2.  **Canonical Name Selection:** Use the most specific proper name found (usually the last name or the fullest name, e.g., "Smith," not "The Officer").
3.  **Variations List:** The \`variations\` array MUST list the canonical name plus all titles, roles, and aliases found in the text for that person (e.g., ["Smith", "Officer", "John"]).

## GENRE-SPECIFIC

1.  **The "System" / Game Interface:**
    *   If you see text inside square brackets (e.g., \`[You have leveled up]\` or \`[Quest Accepted]\`), EXTRACT a character named "System" (or "Interface").
    *   Gender: "female".

2.  **Telepathy & Magic Comms:**
    *   Look for text in angle brackets \`< ... >\`, asterisks \`* ... *\`, or italics explicitly described as "thought-speak" or "party chat".
    *   Treat these as spoken dialogue.

3.  **The "I" Character (First-Person POV):**
    *   If the narration uses "I" (e.g., "I drew my sword and shouted"), you MUST extract a character for this person.
    *   **Naming:** Use their proper name if revealed (e.g., "John"). If unknown, use "Protagonist" or "Main Character".

4.  **Non-Human Entities:**
    *   Monsters, swords that talk, ghosts, and AIs count as characters.

## EXTRACTION
1.  **Must Have Dialogue:** Only include characters who "speak" (via quotes, brackets, or telepathy). Do NOT include mentioned-only people.
2.  **Name Resolution:** Prefer Proper Names > Titles > Roles (e.g., "Azaroth" > "The Dark Lord" > "The Demon").
3.  **Gender Inference:**
    *   "System"/"Constructs" -> "female".
    *   "Beasts" -> "male" (unless specified otherwise).
    *   Use pronouns and titles.

# OUTPUT FORMAT (JSON ONLY)
{"characters": [{"canonicalName": "string", "variations": ["string", "string"], "gender": "male|female|unknown"}]}
`,
    userTemplate: `<text>
{{text}}
</text>`,
  },

  merge: {
    system: `# Character Cleanup and Canonicalization

<TASK>
Merge duplicate identities, specifically handling Fantasy/LitRPG aliases.
</TASK>

# MERGE LOGIC
1.  **Protagonist Linking:** If you have "Protagonist" AND a specific name (e.g., "Jason") and the context implies "I am Jason", merge them. Keep "Jason".
2.  **System/Interface:** Merge "System", "Game Interface", "Blue Box", and "Notification" into a single "System" entry.
3.  **Fantasy Titles:** Merge "The King" with his name "Ranvar" if they refer to the same entity.

# STRICT JSON OUTPUT
{
  "merges": [
    {
      "keep": "ExactInputName",
      "absorb": ["ExactInputName"],
      "variations": ["All", "Aliases", "Here"],
      "gender": "male|female|unknown"
    }
  ],
  "unchanged": ["Name1"]
}`,
    userTemplate: `<characters>
{{characters}}
</characters>`,
  },

  assign: {
    systemPrefix: `# Dialogue Speaker Assigner

<TASK>
Assign a speaker code to every dialogue paragraph.
</TASK>

# GENRE-SPECIFIC MATCHING RULES (Order of Importance)

1.  **Formatting Clues (LitRPG/Magic):**
    *   Text in \`[ ... ]\` -> Assign to **System** (or Interface).
    *   Text in \`< ... >\` -> Assign to the character identified as using telepathy.

2.  **Action Beats (The "Sigh" Rule):**
    *   In web fiction, authors often skip "said" tags. Look for actions *immediately* before or after the dialogue.
    *   *Example:* John rubbed his temples. "Why is this happening?" -> Speaker is **John**.
    *   *Example:* "Die!" The goblin lunged. -> Speaker is **The Goblin**.

3.  **The "Vocative" Trap (Anti-Pattern):**
    *   If a name appears INSIDE the quotes addressing someone, that person is the LISTENER.
    *   *Example:* "Heal me, **Cleric**!" -> Speaker is **NOT** Cleric.

4.  **First-Person Narration:**
    *   If a paragraph contains "I [verb]" (outside quotes) and then speech, the speaker is the **Protagonist**.
    *   *Example:* I looked at the stats. "Not bad." -> Speaker is **Protagonist**.

# AVAILABLE SPEAKERS
{{characterLines}}
{{unnamedEntries}}

# OUTPUT FORMAT
index:CODE
`,
    systemSuffix: `
# START ASSIGNMENT`,
    userTemplate: `<paragraphs>
{{paragraphs}}
</paragraphs>`,
  },
};