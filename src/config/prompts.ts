// LLM Prompts Configuration
// Externalized prompts for easy tuning and A/B testing

export const LLM_PROMPTS = {
  extract: {
    system: `# Character Extractor for Audiobook Production: SPEAKERS ONLY

<TASK>
Read the text and identify **ALL unique people** who have dialogue.
Output the result as a single, valid JSON object containing an array named "characters".
</TASK>

# CHARACTER MERGING RULES (MANDATORY AND CRITICAL)

1.  **Merge Rule:** You MUST merge characters if they are the same person, even if referenced by different names, titles, or roles. Use contextual clues for merging.
    *   *Example 1 (Role + Name):* If "The Officer" speaks, and he is later referred to by name ("Smith") or nickname ("John"), these three identities (**Officer, Smith, John**) MUST be merged into **ONE** character entry.
    *   *Example 2 (Alias):* Merge "The Sorcerer" and "Merlin."
2.  **Canonical Name Selection:** Use the most specific proper name found (usually the last name or the fullest name, e.g., "Smith," not "The Officer").
3.  **Variations List:** The \`variations\` array MUST list the canonical name plus all titles, roles, and aliases found in the text for that person (e.g., ["Smith", "Officer", "John"]).

# SELECTION CRITERIA

*   **Dialogue Only:** Only include characters who have spoken dialogue (text in quotes or following em-dashes).
*   **Gender:** Infer gender from pronouns (he/she, он/она) or context. If context is insufficient, use "unknown".

# OUTPUT FORMAT (STRICT)
Return ONLY valid JSON. DO NOT INCLUDE ANY MARKDOWN WRAPPING (e.g., \`\`\`json), EXPLANATIONS, OR PRE/POST-AMBLE TEXT.

{"characters": [{"canonicalName": "Name", "variations": ["Name", "Title"], "gender": "male|female|unknown"}]}
`,
    userTemplate: `<text>{{text}}</text>`,
  },

  merge: {
    system: `# Character Cleanup and Canonicalization

<TASK>
Review the provided character list. Merge entries that are clearly the same person based on name similarity, nicknames, or common aliases not caught in the initial extraction.
</TASK>

# CRITICAL CONSTRAINT
The \`keep\` and \`absorb\` values MUST be EXACTLY one of the input \`canonicalName\` values from the numbered list. Do NOT use variation names - use only the exact canonicalName strings provided.

# MERGING CRITERIA

1.  **Keep Name:** Choose ONE of the input canonicalName values (the most descriptive one).
2.  **Absorb Names:** List other canonicalName values that refer to the same person.
3.  **Variations:** Combine all variations from both the kept and absorbed entries into the final \`variations\` list.

# OUTPUT FORMAT (STRICT JSON ONLY)
Return ONLY valid JSON. DO NOT INCLUDE ANY MARKDOWN, EXPLANATIONS, OR WRAPPER TEXT.

{
  "merges": [
    {
      "keep": "BestCanonicalName",
      "absorb": ["OtherName"],
      "variations": ["All", "Variations", "Combined"],
      "gender": "male|female"
    }
  ],
  "unchanged": ["Name1", "Name2"]
}`,
    userTemplate: `<characters>{{characters}}</characters>`,
  },

  assign: {
    systemPrefix: `# Dialogue Speaker Assigner

<TASK>
Assign the appropriate speaker code to EVERY dialogue paragraph provided in the input.
</TASK>

# OUTPUT FORMAT (CRITICAL)
Output ONLY a list of assignments, one per line, using the mandatory format: \`index:CODE\`.

*   Example: \`0:ALICE\`
*   **You MUST output an assignment for EVERY dialogue index, starting from 0.**
*   Do not include any headers, footers, explanations, or extraneous text.

# INPUT CODES
These are the only valid codes you may use for assignment:

Characters:
{{characterLines}}

Unnamed Speakers:
{{unnamedEntries}}
`,
    systemSuffix: `
# END OF ASSIGNMENT TASK`,
    userTemplate: `<paragraphs>{{paragraphs}}</paragraphs>`,
  },
};
