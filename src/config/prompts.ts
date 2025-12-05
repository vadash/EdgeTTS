// LLM Prompts Configuration
// Externalized prompts for easy tuning and A/B testing

export const LLM_PROMPTS = {
  extract: {
    system: `# Character Extractor for Audiobook Production

<task>
Read the text and identify **unique people** who speak.
Output a JSON list of characters.
</task>

## Critical Rules for Identity Resolution

<rule_1_contextual_merging>
You MUST merge characters if the text implies they are the same person.
- If "The Wizard" is referred to as "Gandalf", create **ONE** entry.
- If "The detective" is named "Holmes", create **ONE** entry.
- **Canonical Name:** Use the specific proper name (e.g., "Gandalf", "Holmes").
- **Variations:** List all titles, roles, and aliases (e.g., ["Gandalf", "The Wizard", "Mithrandir"]).
</rule_1_contextual_merging>

<rule_2_speakers_only>
Only include characters who have dialogue (text in quotes or following em-dashes).
</rule_2_speakers_only>

<rule_3_gender>
Infer gender from pronouns (he/she, он/она) or grammatical endings. Default to "unknown".
</rule_3_gender>

## Output Format
Return ONLY valid JSON:
{"characters": [{"canonicalName": "Name", "variations": ["Name", "Title"], "gender": "male|female|unknown"}]}`,
    userTemplate: `<text>
{{text}}
</text>`,
  },

  merge: {
    system: `# Character Cleanup

<task>
Review the extracted character list. Merge entries that are obviously the same person based on name similarity.
(Note: Contextual merging should have already happened. Focus here on typos or "First Name" vs "Full Name".)
</task>

## Output Format
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
    userTemplate: `<characters>
{{characters}}
</characters>`,
  },

  assign: {
    systemPrefix: `# Dialogue Speaker Assigner

<task>
Assign a speaker code to EVERY line of dialogue found in the text.
</task>

<inputs>
Characters:
{{characterLines}}

Unnamed Speakers:
{{unnamedEntries}}
</inputs>`,
    systemSuffix: `
## CRITICAL RULES (Order of Precedence)

### 1. The "Vocative Trap" (Addressee != Speaker)
If a quote **starts** with a name, that person is usually the **LISTENER**, not the speaker.
- Text: "Alice? Are you ready?" she asked.
- Logic: The speaker is asking Alice.
- **Result:** Speaker is **NOT** Alice. Look for the person described as "she" (e.g., Sarah).

### 2. Explicit Attribution
- **Tag:** "..." said **Code**. / **Code** asked, "..."
- **Russian:** — ... — сказал **Code**. / — ... — **Code** ответил.
- **Action Beat:** If a sentence describes a character doing something, and the *very next* sentence is a quote with no tag, that character is the speaker.
  - Text: **Bob** sat down. "I am tired."
  - Result: Speaker is **Bob** (Code for Bob).

### 3. Pronoun Resolution
- "..." she said. → Assign to the most recently mentioned female character.
- "..." he said. → Assign to the most recently mentioned male character.

### 4. Conversation Alternation
- If a line has no attribution, assume it is the **other** person in the conversation responding.
- Pattern: Speaker A → Speaker B → Speaker A → Speaker B.

### 5. Russian Em-Dash Format
- Treat lines starting with \`—\` (em-dash) exactly like quoted text.
- **MANDATORY:** You must output a speaker assignment for every dashed line, even short ones.
  - Example: \`— Понял.\` (Understood.)

## Output Format
One line per dialogue sentence: \`index:code\`
- Example: \`0:ALICE\`
- Do not output narration lines.
- Do not output explanations.`,
    userTemplate: `<sentences>
{{sentences}}
</sentences>`,
  },
};