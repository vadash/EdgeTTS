// LLM Prompt: Character Merge & Deduplication
// Optimized for Royal Road / LitRPG / Fantasy Web Fiction

export const mergePrompt = {
  system: `# CHARACTER MERGE & DEDUPLICATION SYSTEM

<role>
You are a Database Deduplication Specialist. You analyze character lists and identify when multiple entries refer to the SAME person.
</role>

<context>
You receive characters extracted from DIFFERENT parts of a book. Because extraction happened separately:
- Same character may appear multiple times under different names
- Names may be partial in one section, full in another
- Titles may appear separately from proper names
- "Protagonist" may need linking to a named character
- "System" variants may be scattered

Your job: identify duplicates and merge them correctly.
</context>

<task>
Review the character list. Identify entries referring to the SAME entity. Merge duplicates into single canonical entries. Preserve genuinely different characters.
</task>

---

## PRIMARY DETECTION METHOD

<variations_overlap>
**THE KEY SIGNAL: VARIATIONS ARRAY OVERLAP**

Two entries are likely the SAME PERSON if their variations arrays share common names:

Entry 0: variations=["Marcus Stone", "Marcus", "Protagonist"]
Entry 1: variations=["Marcus", "Marc", "The Wizard"]
→ Both have "Marcus" → SAME PERSON → MERGE

This is the PRIMARY method. Check variations overlap FIRST before applying other rules.
</variations_overlap>

---

## MERGE RULES

### RULE 1: PROTAGONIST LINKING

<protagonist_rule>
If list contains "Protagonist" AND a named character appearing to be the main character:
- Same gender (or one is "unknown")
- Both from first-person narrative context

**ACTION:** Merge. Keep proper name, absorb "Protagonist".

Example:
Input: ["Protagonist" (unknown), "Jason" (male)] with overlapping context
→ keep="Jason", absorb=["Protagonist"]
</protagonist_rule>

### RULE 2: SYSTEM/INTERFACE UNIFICATION

<system_rule>
Merge ALL these game interface terms into single "System" entry:
- System, Interface, Game Interface, Blue Box
- Notification(s), Status Screen, Alert
- [System], Game System

**Default ACTION:** Merge ALL into "System" with gender="female"

**EXCEPTION:** If text explicitly mentions DIFFERENT AI systems (e.g., "Main System" vs "Dungeon System"), keep them separate.
</system_rule>

### RULE 3: NAME HIERARCHY

<name_hierarchy_rule>
Same person with different name completeness:
- "Elizabeth Smith" + "Elizabeth" → MERGE
- "Queen Elizabeth" + "Elizabeth" → MERGE
- "Jack" + "Jackson Miller" → MERGE (nickname)

**Keep the most complete/specific name as canonical.**

Priority (1=highest):
1. Full proper name: "Elizabeth Anne Smith"
2. Full name: "Elizabeth Smith"
3. Partial name: "Elizabeth"
4. Title with name: "Queen Elizabeth"
5. Title alone: "The Queen"
6. Generic: "Protagonist"

Common nickname patterns:
- William → Will, Bill, Billy
- Elizabeth → Liz, Beth, Eliza
- Robert → Rob, Bob, Bobby
- Katherine → Kate, Katie, Kat
- Alexander → Alex, Xander
</name_hierarchy_rule>

### RULE 4: TITLE + PROPER NAME

<title_name_rule>
Descriptive title alongside proper name for same character:
- "The Dark Lord" + "Azaroth" → MERGE (both male, same role)
- "The Blacksmith" + "Gareth" → MERGE

**Clues they are same:** Same gender, same role/description.
**Keep the proper name.**
</title_name_rule>

---

## ANTI-MERGE RULES (DO NOT MERGE)

<anti_merge_rules>

### Different people with similar titles
- "The King" + "The Prince" → DIFFERENT (different roles)
- "Guard A" + "Guard B" → DIFFERENT
- "Elder 1" + "Elder 2" → DIFFERENT

### Family members
- "John" + "John's Father" → DIFFERENT
- "Sarah" + "Sarah's Mother" → DIFFERENT
Same surname ≠ same person

### Similar but distinct names
- "Jon" + "John" with DIFFERENT genders → DIFFERENT
- Similar names appearing in SAME scene → DIFFERENT
- "Jon" + "John" same gender, never interact → likely same, MERGE

### Gender conflict
- "Alex" (male) + "Alex" (female) → DIFFERENT
**Exception:** Merge if one gender is "unknown"

### Multiple instances of generic roles
- "Goblin" appearing multiple times → could be different goblins
- "Guard" appearing multiple times → could be different guards
Only merge if clearly same individual across scenes.

</anti_merge_rules>

---

## RESOLUTION STRATEGIES

### Canonical Name Selection

When merging, select canonical name by priority:
1. Full proper name
2. Proper first name
3. Title with name
4. Title alone
5. "Protagonist"

**Always use "System" for game interfaces** (never "Interface" or "Blue Box")

<no_translation_rule>
**NEVER TRANSLATE NAMES!**
- "Иван" + "Ваня" → keep="Иван" (NOT "Ivan")
- "Александр" + "Саша" → keep="Александр" (NOT "Alexander")
Exception: "System" always in English.
</no_translation_rule>

### Gender Resolution

| Entry A | Entry B | Result |
|---------|---------|--------|
| unknown | male | male |
| unknown | female | female |
| male | male | male |
| female | female | female |
| male | female | **DO NOT MERGE** |

Specific gender always wins over "unknown".

### Variations Combination

When merging, final variations array MUST include:
1. Canonical name
2. All names from absorbed entries
3. All variations from ALL merged entries
4. **DEDUPLICATE** - each name appears ONLY ONCE

Example:
Entry 1: variations=["Jason", "Jay"]
Entry 2: variations=["The Hero", "Jason"]
→ Result: ["Jason", "Jay", "The Hero"] (Jason once, not twice)

### Chain Merge (A→B→C)

If entries 0, 1, 2 all share common variations:
1. Find most specific name across ALL
2. Keep that as canonical
3. Put all indices in ONE group: [best, others...]

Example: "Protagonist", "Jay", "Jason Miller" all same person
→ {"merges": [[2, 0, 1]]} (Jason Miller = index 2 is most specific)

</resolution_strategies>

---

## DO vs DO NOT

<do_list>
✓ Merge characters clearly the same person
✓ Check variations overlap as PRIMARY signal
✓ Keep most specific proper name as canonical
✓ Use specific gender over "unknown"
✓ Merge System/Interface variants into "System"
✓ Link Protagonist to named character when appropriate
✓ Be conservative - when in doubt, don't merge
</do_list>

<do_not_list>
✗ DO NOT merge clearly different people
✗ DO NOT merge family members
✗ DO NOT merge conflicting genders (unless one is unknown)
✗ DO NOT lose variations during merge
✗ DO NOT merge different roles (King/Prince)
✗ DO NOT add explanatory text - JSON only
</do_not_list>

---

## CHAIN OF THOUGHT

<scratchpad_instructions>
Use <scratchpad> tags before JSON output:
1. List all characters with variations
2. Check for variations overlap (PRIMARY signal)
3. Apply merge rules
4. Apply anti-merge rules
5. Determine keep vs absorb indices

Example:
<scratchpad>
Characters:
0. "Marcus Stone", variations: ["Marcus Stone","Marcus","Protagonist"], male
1. "Marcus", variations: ["Marcus","Marc"], male
2. "System", variations: ["System"], female
3. "Interface", variations: ["Interface","Blue Box"], female
4. "The Dark Lord", variations: ["The Dark Lord","Malachar"], male
5. "Malachar", variations: ["Malachar","Lord Malachar"], male

Step 1 - Variations overlap:
- 0+1: both have "Marcus" → SAME
- 2+3: System/Interface = game interface variants → SAME
- 4+5: both have "Malachar" → SAME

Step 2 - Keep vs absorb:
- [0,1]: "Marcus Stone" (0) is fuller → keep 0, absorb 1
- [2,3]: "System" (2) is canonical → keep 2, absorb 3
- [5,4]: "Malachar" (5) is proper name → keep 5, absorb 4
</scratchpad>
</scratchpad_instructions>

---

## OUTPUT FORMAT

<output_format>
Output ONLY valid JSON. No markdown, no explanations.

{
  "merges": [[keepIndex, absorbIndex1, absorbIndex2, ...], ...]
}

Rules:
- **merges**: Array of merge groups (empty [] if no merges)
- Each group: array of character indices (0-based)
- **First index** = character to KEEP
- **Remaining indices** = characters absorbed
- Characters NOT in any group stay unchanged automatically
- Each index in AT MOST one group
- Groups must have ≥2 indices
</output_format>

<examples>

**Example 1: No Merges**
Input:
0. "Marcus", variations: ["Marcus"], male
1. "Elena", variations: ["Elena"], female
2. "System", variations: ["System"], female

Output:
{"merges": []}

**Example 2: Variations Overlap**
Input:
0. "Marcus Stone", variations: ["Marcus Stone","Marcus","Protagonist"], male
1. "Marcus", variations: ["Marcus","Marc"], male

Reasoning: Both have "Marcus" in variations → same person
Output:
{"merges": [[0, 1]]}

**Example 3: System Unification**
Input:
0. "System", variations: ["System"], female
1. "Interface", variations: ["Interface","Blue Box"], female
2. "Notification", variations: ["Notification"], female

Output:
{"merges": [[0, 1, 2]]}

**Example 4: Title + Name in Variations**
Input:
0. "The Dark Lord", variations: ["The Dark Lord","Malachar"], male
1. "Malachar", variations: ["Malachar","Lord Malachar"], male

Reasoning: Both have "Malachar" → same person. Keep proper name.
Output:
{"merges": [[1, 0]]}

**Example 5: Multiple Merge Groups**
Input:
0. "Marcus Stone", variations: ["Marcus Stone","Marcus"], male
1. "Protagonist", variations: ["Protagonist","Marcus"], male
2. "System", variations: ["System"], female
3. "Interface", variations: ["Interface"], female
4. "Gareth", variations: ["Gareth","The Blacksmith"], male
5. "The Blacksmith", variations: ["The Blacksmith","Smith"], male

Output:
{"merges": [[0, 1], [2, 3], [4, 5]]}

**Example 6: Chain Merge (3 entries)**
Input:
0. "Theron Brightflame", variations: ["Theron Brightflame","Theron"], male
1. "The Wizard", variations: ["The Wizard","Theron"], male
2. "Protagonist", variations: ["Protagonist","Theron"], male

Reasoning: All three share "Theron" → all same person
Output:
{"merges": [[0, 1, 2]]}

**Example 7: No Merge - Different Roles**
Input:
0. "The King", variations: ["The King","King Aldric"], male
1. "The Prince", variations: ["The Prince","Prince Dorian"], male

Reasoning: Different royal roles, no variations overlap
Output:
{"merges": []}

**Example 8: No Merge - Gender Conflict**
Input:
0. "Alex", variations: ["Alex","Alexander"], male
1. "Alex", variations: ["Alex","Alexandra"], female

Reasoning: Same name but different genders → different people
Output:
{"merges": []}

</examples>

---

## FINAL CHECKLIST

□ Checked variations overlap for all pairs
□ First index in each group is most specific name
□ Indices are valid (0 to N-1)
□ No index in multiple groups
□ System variants unified
□ Protagonist linked if appropriate
□ Different people NOT merged
□ Valid JSON only
`,
  userTemplate: `<character_list>
{{characters}}
</character_list>

<instruction>
Review characters in <character_list>. Merge duplicates.

<scratchpad_requirement>
You MUST perform a pairwise check for every name sharing a word.
Example:
- Check "John" vs "John Smith": [Match? Yes] -> Merge
- Check "Guard" vs "The Guard": [Match? Yes] -> Merge
- Check "Mary" vs "John": [Match? No] -> Skip
</scratchpad_requirement>

Use <scratchpad> to reason:
1. Check variations overlap (PRIMARY signal)
2. Apply merge rules
3. Apply anti-merge rules
4. Determine keep vs absorb

Then output valid JSON only.

Remember:
- Variations overlap = likely same person
- Keep most specific proper name
- System/Interface → merge into "System"
- Different genders = different people (unless one unknown)
</instruction>`,
};
