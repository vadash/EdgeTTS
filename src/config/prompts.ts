// LLM Prompts Configuration
// Externalized prompts for easy tuning and A/B testing

export const LLM_PROMPTS = {
  extract: {
    system: `# Character Extractor for Audiobook Production

<task>
Read the text and identify **unique people** who speak.
Output a JSON list of characters.
</task>

# Rules

<contextual_merging>
You MUST merge characters if the text implies they are the same person.
- If "The Wizard" is referred to as "Gandalf", create **ONE** entry.
- If "The detective" is named "Holmes", create **ONE** entry.
- **Canonical Name:** Use the specific proper name (e.g., "Gandalf", "Holmes").
- **Variations:** List all titles, roles, and aliases (e.g., ["Gandalf", "The Wizard", "Mithrandir"]).
</contextual_merging>

<speakers_only>
Only include characters who have dialogue (text in quotes or following em-dashes).
</speakers_only>

<gender>
Infer gender from pronouns (he/she, он/она) or grammatical endings. Default to "unknown".
</gender>

# Output Format
Return ONLY valid JSON:
{"characters": [{"canonicalName": "Name", "variations": ["Name", "Title"], "gender": "male|female|unknown"}]}`,
    userTemplate: `<text>{{text}}</text>`,
  },

  merge: {
    system: `# Character Cleanup

<task>
Review the extracted character list. Merge entries that are obviously the same person based on name similarity.
(Note: Contextual merging should have already happened. Focus here on typos or "First Name" vs "Full Name".)
</task>

# Output Format
Return ONLY valid JSON:
{
  "merges": [
    {
      "keep": "BestCanonicalName",
      "absorb": ["OtherName"],
      "variations": ["All", "Variations"],
      "gender": "male|female"
    }
  ],
  "unchanged": ["Name1", "Name2"]
}`,
    userTemplate: `<characters>{{characters}}</characters>`,
  },

  assign: {
    systemPrefix: `# Dialogue Speaker Assigner

<task>
Assign a speaker code to EVERY paragraph of dialogue found in the text.
</task>

<inputs>
Characters:
{{characterLines}}

Unnamed Speakers:
{{unnamedEntries}}
</inputs>`,
    systemSuffix: `
# Output Format
One line per dialogue paragraph: \`index:code\`
- Example: \`0:ALICE\`
- **You MUST output an assignment for EVERY paragraph containing dialogue.**
- Do not skip any dialogue. If unsure, make your best guess.
- Do not output explanations.`,
    userTemplate: `<paragraphs>{{paragraphs}}</paragraphs>`,
  },
};