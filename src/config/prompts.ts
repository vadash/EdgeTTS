// LLM Prompts Configuration
// Externalized prompts for easy tuning and A/B testing

export const LLM_PROMPTS = {
  extract: {
    system: `# Character Extractor for Audiobook Production

<task>
Extract ONLY characters who SPEAK dialogue. Return ONE entry per unique person.
</task>

## Step 1: Identify Speaking Characters

<critical>
ONLY extract characters who have dialogue lines marked by:
- Quotation marks: \`"..."\` or \`«...»\`
- Em-dash (Russian style): \`— ...\`

DO NOT include characters who:
- Are only mentioned in narration
- Only perform actions without speaking
- Are referenced but never speak
</critical>

## Step 2: Choose canonicalName

<priority>
Scan the ENTIRE text first, then choose the BEST identifier:
1. **Surname** (family name) — HIGHEST priority for Western names
2. **Given name** (first name, nickname) — use when no surname available
3. **Title/role alone** — ONLY if no proper name exists anywhere
</priority>

<rules>
- Prefer surname over first name when both exist
- Prefer proper names over titles/roles
- For Russian: use proper names over relationship terms (брат, сестра)
</rules>

## Step 3: Merge Same-Person References

<critical>
You MUST merge characters who are the SAME PERSON into ONE entry.

**Automatic merge triggers:**
- Title and surname used interchangeably in dialogue attribution
- First name used as direct address to someone identified by title/surname
- Same person referred to differently in adjacent attributions

**How to detect same person:**
- "the Captain was there... Tennyson said" in same scene = SAME person → merge into Tennyson
- "Name1, are you okay?" followed by "Name2 replied" = often SAME person
- Alternating title/name in dialogue: "said the Captain... Tennyson replied... said the Captain" = ONE person

**Result:** ONE character entry with ALL variations listed.
</critical>

## Step 4: Build variations Array

<important>
Include ALL forms used to refer to each character:
- canonicalName (must be first)
- First name, surname, nicknames
- Titles: Captain, Doctor, Professor, etc.
- Role descriptions: the brother, the officer, etc.
- Any other references used in dialogue attribution
</important>

## Step 5: Detect Gender

<detection>
Use contextual clues:
- Pronouns: he/she, him/her, его/её, он/она
- Russian verb endings: -л (male), -ла (female)
- Titles: Mr./Mrs., господин/госпожа
Default to \`"unknown"\` when uncertain.
</detection>

## Output Format

<format>
Return ONLY valid JSON (no markdown, no explanation):
{"characters": [{"canonicalName": "Name", "variations": ["Name", "Alias1", ...], "gender": "male|female|unknown"}]}

If no speaking characters found: {"characters": []}
</format>`,
    userTemplate: `<text>
{{text}}
</text>`,
  },

  merge: {
    system: `# Character Deduplication for Audiobook Production

<task>
Identify characters that are the SAME PERSON but were extracted with different canonical names.
Merge duplicates into single entries.
</task>

## When to Merge

<merge_triggers>
Characters are the SAME PERSON if:
- They share a variation (e.g., both have "Captain" in variations)
- One's canonicalName appears in another's variations
- First name + surname relationship (e.g., "John" and "Smith" for John Smith)
- Title + name relationship (e.g., "Captain" and "Tennyson" for Captain Tennyson)
</merge_triggers>

<warning>
Do NOT merge characters who:
- Simply have similar roles (two different doctors)
- Have generic titles without clear connection
- Are distinct people who happen to share a title
</warning>

## How to Merge

<rules>
1. Choose the BEST canonicalName (prefer surname > first name > title)
2. Combine ALL variations from both characters
3. Keep the most specific gender (prefer male/female over unknown)
</rules>

## Output Format

<format>
Return ONLY valid JSON (no markdown, no explanation):
{
  "merges": [
    {
      "keep": "BestCanonicalName",
      "absorb": ["OtherName1", "OtherName2"],
      "variations": ["all", "combined", "variations"],
      "gender": "male|female|unknown"
    }
  ],
  "unchanged": ["Character1", "Character2"]
}

- "keep": the canonical name to use for merged character
- "absorb": canonical names being merged into "keep"
- "unchanged": canonical names of characters that don't need merging
</format>`,
    userTemplate: `<characters>
{{characters}}
</characters>`,
  },

  assign: {
    // Note: system prompt has dynamic sections (character codes, unnamed speakers)
    // These are injected via the {{characterLines}} and {{unnamedEntries}} placeholders
    systemPrefix: `# Dialogue Speaker Tagger for Audiobook Production

<task>
Identify which character speaks each dialogue line. Output speaker codes for ALL dialogue lines.
</task>

## Character Codes

<characters>
{{characterLines}}
</characters>

<unnamed_speakers>
{{unnamedEntries}}

Use ONLY for named speakers not in the character list. Do NOT use for anonymous speakers.
</unnamed_speakers>`,
    systemSuffix: `

## What is Dialogue?

<dialogue_markers>
A sentence contains dialogue if it has:
- Quotation marks: \`"..."\` or \`«...»\`
- Em-dash at start (Russian): \`— ...\`

ALL dialogue sentences must be tagged with a speaker code.
Pure narration (no quotes or em-dash) = do NOT tag.
</dialogue_markers>

## Speaker Attribution Rules

<rules priority="ordered">

### Rule 1: Same-Sentence Attribution (HIGHEST PRIORITY)

Check if the SAME sentence contains a speech verb with speaker name OR pronoun:

**With name:**
- \`"...", Name said\` or \`"...", said Name\`
- \`Name said, "..."\`

**With pronoun:**
- \`"...", she said\` → find the most recently mentioned female character
- \`"...", he muttered\` → find the most recently mentioned male character
- \`"...", она сказала\` → female character from context
- \`"...", он спросил\` → male character from context

**Russian patterns:**
- \`— ..., — сказал Name.\` or \`— ... — сказал Name.\`
- \`— ..., — спросил/ответил/проговорил Name.\`

<critical>
ANY speech verb (said, asked, replied, muttered, whispered, mumbled, спросил, сказал, ответил, проговорил, etc.) with a name or pronoun = USE THAT SPEAKER.

For pronouns: look at PREVIOUS sentence to find the character being referred to.
</critical>

### Rule 2: Adjacent-Sentence Attribution

If a sentence has dialogue but NO same-sentence attribution, check the PREVIOUS sentence:
- Narration mentioning a character immediately before dialogue → that character speaks
- Match by title if character has that alias

### Rule 3: Match Aliases to Characters

When attribution uses a title/role, match to the character whose aliases include it:
- "said the Captain" → find character with "Captain" in aliases
- "сказал брат" → find character with "брат" in aliases

### Rule 4: Vocatives are NOT Speakers

<warning>
A name at the START of quoted text (followed by comma) = ADDRESSEE, not speaker:
- \`"Alan, I need help"\` → Alan is being addressed, look for actual speaker elsewhere
- \`"Март, что случилось?"\` → Март is being addressed

The speaker must be found from attribution or context.
</warning>

### Rule 5: Conversation Flow (Alternation)

<important>
When dialogue lines have NO explicit attribution, use conversation alternation:

1. Identify the last speaker with explicit attribution
2. The next unattributed dialogue = the OTHER person in the conversation
3. Continue alternating: A → B → A → B...

This is CRITICAL for short replies like:
- \`— Question?\` (attributed to A)
- \`— Short answer.\` (no attribution = B)
- \`— Another question?\` (no attribution = A)

EVERY dialogue line must have a speaker assigned, even without attribution.
</important>

### Rule 6: Anonymous/Generic Speakers → SKIP

<skip_rule>
Do NOT tag when speaker is anonymous/generic:
- "one of them asked", "someone said", "a voice called"
- "один из них спросил", "кто-то сказал"

OMIT these from output (they become narration).
</skip_rule>

</rules>

## Output Format

<format>
One line per dialogue sentence: \`index:code\`

- Tag ALL dialogue lines with identified speakers
- OMIT narration lines (no quotes/em-dash)
- OMIT anonymous speaker lines
- No explanations

Empty output = all lines are narration.
</format>`,
    userTemplate: `<sentences>
{{sentences}}
</sentences>`,
  },
};
