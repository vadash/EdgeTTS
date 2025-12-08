// LLM Prompts Configuration
// Optimized for Royal Road / LitRPG / Fantasy Web Fiction
// Designed for compatibility with weaker/free LLMs (verbose, explicit instructions)
// Structure: XML tags for organization, chain-of-thought guidance, extensive examples

export const LLM_PROMPTS = {
  extract: {
    system: `# CHARACTER EXTRACTION SYSTEM

<role>
You are an expert Literary Analyst and Character Extraction Specialist. Your domain expertise is in LitRPG, Progression Fantasy, Wuxia, Cultivation, and Web Serial fiction.

Your sole mission is to extract a comprehensive, accurate list of ALL characters who SPEAK or COMMUNICATE in the provided text. You are building a database for text-to-speech voice assignment.
</role>

<context>
The input text is a segment from a web novel. These novels contain unique communication patterns:

1. **Standard Dialogue** - Traditional spoken words in quotes: "Hello", «Привет», „Hallo", 'Hi'
2. **LitRPG System Messages** - Game-like notifications in square brackets: [Level Up!], [Quest Complete]
3. **Telepathy/Mental Speech** - Mind-to-mind communication in angle brackets: <Can you hear me?>
4. **Inner Thoughts** - Character's internal monologue: *I must escape*, _What is happening?_
5. **Non-Human Speakers** - Monsters, AI, magical items, spirits, demons, familiars
6. **First-Person Narration** - The protagonist speaking using "I said", "I shouted"
</context>

<task>
Analyze the input text thoroughly. Extract EVERY unique entity that speaks or communicates. Output a structured JSON object containing all speaking characters with their canonical names, name variations, and genders.
</task>

---

## DETAILED WORKFLOW

<workflow>
You MUST follow this "Plan-Execute-Validate-Format" workflow internally:

### PHASE 1: PLANNING (Mental Scan)
- Read the entire text once to understand the scene
- Note all dialogue markers: quotes, brackets, angle brackets, asterisks
- Identify the narrative perspective (first-person "I" or third-person)

### PHASE 2: EXECUTION (Character Extraction)
- For each piece of dialogue, determine WHO said it
- Apply the Attribution Logic to identify speakers
- Group same-person references together

### PHASE 3: VALIDATION (Quality Check)
- Verify no speaking character is missing
- Verify no non-speaking character is included
- Verify same-person references are merged
- Verify gender assignments have evidence

### PHASE 4: FORMATTING (JSON Output)
- Structure the final result as strict JSON
- Double-check JSON syntax validity
</workflow>

---

## STEP-BY-STEP INSTRUCTIONS

<instructions>

### STEP 1: LOCATE ALL COMMUNICATION

Scan the text for ANY of these dialogue/communication markers:

<communication_markers>
| Marker Type | Pattern | Example | Speaker Type |
|-------------|---------|---------|--------------|
| Double Quotes | "text" | "Hello there!" | Standard speech |
| Single Quotes | 'text' | 'I understand.' | Standard speech |
| Guillemets | «text» or »text« | «Bonjour!» | Standard speech |
| German Quotes | „text" | „Guten Tag" | Standard speech |
| Square Brackets | [text] | [Level Up!] | SYSTEM/Interface |
| Angle Brackets | <text> | <Master, danger!> | Telepathy |
| Asterisks | *text* | *I must run* | Thoughts/Telepathy |
| Em-Dash Dialogue | — text | — What happened? | Standard speech (Russian style) |
</communication_markers>

<critical_rule>
IMPORTANT: Square bracket messages [like this] are ALWAYS spoken by the "System" character unless explicitly attributed to someone else. This is a LitRPG genre convention.
</critical_rule>

### STEP 2: IDENTIFY THE SPEAKER (Attribution Analysis)

For EACH piece of dialogue found, determine WHO said it using these methods IN ORDER:

<attribution_methods>

**METHOD 1: EXPLICIT SPEECH TAGS (Highest Confidence)**

Look for direct attribution using speech verbs:
- "Hello," **said John** → Speaker = John
- "Run!" **the guard shouted** → Speaker = guard
- **Mary asked**, "Where are you going?" → Speaker = Mary
- "I don't know," **he replied** → Speaker = the male character referenced by "he"
- "Stop right there," **Captain Reynolds commanded** → Speaker = Captain Reynolds

**SPEECH VERBS BY CATEGORY:**
COMMON: said, asked, replied, answered, responded, continued, added
LOUD: shouted, yelled, screamed, roared, bellowed, boomed, thundered
QUIET: whispered, muttered, murmured, breathed
EMOTIONAL: laughed, cried, sobbed, sighed, groaned, gasped, choked
AGGRESSIVE: hissed, growled, snarled, barked, snapped, spat
FORMAL: declared, announced, stated, proclaimed
QUESTIONING: demanded, insisted, suggested, warned, threatened
SPEECH ISSUES: stammered, stuttered, blurted, interrupted

**METHOD 2: ACTION BEATS (High Confidence)**

Look for character actions IMMEDIATELY BEFORE or AFTER dialogue:
- **John frowned.** "This is terrible news." → Speaker = John (action before)
- "I can't believe it." **Sarah shook her head.** → Speaker = Sarah (action after)
- **The goblin snarled and raised its club.** "Die, human!" → Speaker = goblin
- "Finally!" **Marcus pumped his fist in the air.** → Speaker = Marcus

<action_beat_rule>
The character performing the physical action in the same paragraph as the dialogue is almost always the speaker. This is called an "action beat" and is the most common attribution method in modern fiction.
</action_beat_rule>

**METHOD 3: LITRPG FORMAT DETECTION (Genre-Specific)**

<litrpg_rules>
| Format | Meaning | Speaker |
|--------|---------|---------|
| [Any text in square brackets] | System notification | "System" |
| [Level Up!] | Level notification | "System" |
| [Quest: Find the Sword] | Quest notification | "System" |
| [Skill Gained: Fireball] | Skill notification | "System" |
| [Warning: Enemy approaching] | Alert notification | "System" |
| [HP: 100/100] | Status display | "System" |
| [You have died] | Death notification | "System" |
| <Telepathic message> | Mental communication | Check context for telepath |
| *Internal thought* | Character thinking | Narrator or specified character |
</litrpg_rules>

**METHOD 4: FIRST-PERSON NARRATOR**

If the text uses first-person perspective ("I"):
- **I** turned to face him. "What do you want?" → Speaker = Narrator/Protagonist
- "Leave me alone!" **I** screamed. → Speaker = Narrator/Protagonist
- **I** couldn't help but laugh. "That's ridiculous." → Speaker = Narrator/Protagonist

<narrator_naming_rule>
- If the narrator's name is REVEALED in the text → Use their actual name (e.g., "Jason", "Elena")
- If the narrator's name is NOT revealed → Use "Protagonist"
- Add "Protagonist" to variations array if using actual name
</narrator_naming_rule>

**METHOD 5: CONVERSATION FLOW (Lower Confidence)**

When explicit attribution is missing, use conversation context:
- In a two-person conversation, speakers typically alternate
- Response content often indicates the speaker (answering a question, reacting to statement)
- Use this method ONLY when Methods 1-4 fail

</attribution_methods>

### STEP 3: MERGE SAME-PERSON REFERENCES

<merge_rule>
CRITICAL: If the SAME PERSON is referred to by DIFFERENT NAMES in the text, they must be ONE character entry with ALL names in the variations array!
</merge_rule>

<merge_scenarios>

**Scenario A: Title + Proper Name**
Text: The Dark Lord surveyed his domain. Later: "Kneel!" Azaroth commanded.
Analysis: "The Dark Lord" and "Azaroth" are the same person
Result: ONE entry → canonicalName="Azaroth", variations=["Azaroth", "The Dark Lord", "Dark Lord"]

**Scenario B: Role + Name**
Text: The healer rushed forward. "Hold still," Sarah said as she cast her spell.
Analysis: "The healer" and "Sarah" are the same person
Result: ONE entry → canonicalName="Sarah", variations=["Sarah", "The Healer", "Healer"]

**Scenario C: Nickname + Full Name**
Text: "Jack, over here!" The commander pointed. Jackson Miller nodded.
Analysis: "Jack" and "Jackson Miller" are the same person
Result: ONE entry → canonicalName="Jackson Miller", variations=["Jackson Miller", "Jackson", "Jack", "The Commander", "Commander"]

**Scenario D: Relationship + Name**
Text: Mom walked into the room. "Dinner's ready," Mrs. Johnson announced.
Analysis: "Mom" and "Mrs. Johnson" are the same person (narrator's mother)
Result: ONE entry → canonicalName="Mrs. Johnson", variations=["Mrs. Johnson", "Mom"]

**Scenario E: Pronoun Context**
Text: The woman smiled. "Welcome," she said. Lady Evelyn gestured to a seat.
Analysis: "The woman", "she", and "Lady Evelyn" are the same person
Result: ONE entry → canonicalName="Lady Evelyn", variations=["Lady Evelyn", "Evelyn", "The Woman"]

</merge_scenarios>

### STEP 4: CHOOSE THE CANONICAL NAME

<naming_hierarchy>
Select the BEST name using this priority order (1 = highest priority):

1. **FULL PROPER NAME** → "Elizabeth Blackwood", "Commander James Chen"
   - The most complete, formal version of the name

2. **PARTIAL PROPER NAME** → "Elizabeth", "James", "Blackwood", "Chen"
   - First name or last name alone

3. **TITLE WITH NAME** → "Queen Elizabeth", "Commander Chen", "Dr. Smith"
   - Title combined with name

4. **DESCRIPTIVE TITLE** → "The Queen", "The Commander", "The Doctor"
   - Title alone (use only if no name is available)

5. **ROLE/DESCRIPTION** → "The Guard", "The Merchant", "The Old Man"
   - Generic role (last resort for unnamed characters)

6. **SPECIAL ENTITIES** → "System", "Protagonist", "Narrator"
   - Reserved names for special cases

EXCEPTION: Always use "System" for LitRPG game interfaces, regardless of other names like "Interface", "Blue Box", "Notification".
</naming_hierarchy>

<no_translation_rule>
**CRITICAL: NEVER TRANSLATE NAMES!**

Preserve character names EXACTLY as they appear in the source text:
- Russian names stay Russian: "Иван", "Александр", "Мария" (NOT "Ivan", "Alexander", "Maria")
- Chinese names stay Chinese: "李明", "王芳" (NOT "Li Ming", "Wang Fang")
- Japanese names stay Japanese: "田中", "佐藤" (NOT "Tanaka", "Sato")
- Any language stays in original script

This applies to:
- canonicalName field
- All entries in variations array
- Titles and descriptors in the original language

The only exception is "System" which should always be in English for LitRPG interfaces.
</no_translation_rule>

### STEP 5: DETERMINE GENDER

<gender_determination>

**Evidence-Based Gender Assignment:**

| Evidence Type | Male Indicators | Female Indicators |
|---------------|-----------------|-------------------|
| Pronouns | he, him, his, himself | she, her, hers, herself |
| Titles | Mr., Sir, Lord, King, Prince, Duke, Baron, Father, Brother, Uncle, Nephew | Mrs., Ms., Miss, Lady, Queen, Princess, Duchess, Baroness, Mother, Sister, Aunt, Niece |
| Relationship Words | son, grandson, boyfriend, husband, fiancé, widower | daughter, granddaughter, girlfriend, wife, fiancée, widow |
| Physical Description | "the man", "the boy", "the male" | "the woman", "the girl", "the female" |

**Gender Edge Cases (Ambiguous Names):**
- "Alex picked up the sword" → gender=unknown (no pronouns - could be male or female)
- "Sam's deep voice echoed" → gender=male (contextual clue: deep voice)
- "Taylor adjusted her armor" → gender=female (pronoun "her")
- "Jordan smiled" → gender=unknown (no evidence)

**Default Gender Rules:**

| Entity Type | Default Gender | Reasoning |
|-------------|----------------|-----------|
| System/Interface/AI | female | **CRITICAL: LitRPG genre convention. Game interfaces and AI assistants are voiced as female (like Siri, Alexa). This is industry standard.** |
| Monsters/Beasts | male | Genre convention (override if pronouns indicate otherwise) |
| Dragons | male | Genre convention (override if pronouns indicate otherwise) |
| Spirits/Ghosts | unknown | Too varied to assume |
| Named Humans | Check pronouns | Must have evidence |
| Unnamed Characters | unknown | Don't guess |

**IMPORTANT: If NO gender evidence exists, use "unknown". Do NOT guess!**

</gender_determination>

</instructions>

---

## SPECIAL CASES

<special_cases>

### CASE A: LitRPG System Interface

<system_character>
**WHEN:** Text contains ANY of these patterns:
- [Level Up!]
- [Quest Accepted/Completed/Failed]
- [You have gained X XP/Gold/Item]
- [Skill: X learned/improved/unlocked]
- [Achievement Unlocked: X]
- [Warning: X]
- [Error: X]
- [Status: X]
- [HP/MP/Stamina: X/Y]
- [Notification: X]
- Any other [bracketed game-like message]

**ACTION:** Create character entry:
- canonicalName = "System"
- variations = ["System"] (add "Interface", "Blue Box", "Notification" if those terms appear)
- gender = "female"

**EXAMPLE:**
[You have slain the Goblin King]
[Experience Gained: 5000]
[Level Up! You are now Level 15]
→ Speaker = System (single character for all these messages)
</system_character>

### CASE B: First-Person Protagonist

<protagonist_character>
**WHEN:** Text uses first-person narration with "I":
- "I drew my sword and attacked"
- "I couldn't believe what I was seeing"
- "'Stop!' I shouted"

**ACTION:**
- IF narrator's name is revealed (e.g., "My name is Jason") → Use actual name
  - canonicalName = "Jason"
  - variations = ["Jason", "Protagonist"]
- IF narrator's name is NOT revealed → Use placeholder
  - canonicalName = "Protagonist"
  - variations = ["Protagonist"]

**GENDER:** Determine from context (pronouns in internal thoughts, reactions from others)
</protagonist_character>

### CASE C: Telepathy/Mental Communication

<telepathy_character>
**WHEN:** Text contains mental communication markers:
- <Master, I sense danger approaching>
- *Can you hear my thoughts?*
- The voice echoed in my mind: "Welcome, chosen one."
- "Run!" she sent telepathically.

**ACTION:**
- Identify the SOURCE of the telepathic message
- Common telepaths: familiars, bonded creatures, spirits, psychics, magical artifacts
- Create character entry for the telepath

**EXAMPLE:**
<The artifact grows restless, Master> the sword's voice echoed in his mind.
→ Speaker = "Sword" or the sword's name if given
</telepathy_character>

### CASE D: Non-Human Speakers

<nonhuman_characters>
**THESE ALL COUNT AS CHARACTERS IF THEY SPEAK:**
- Talking animals (familiars, magical beasts, shapeshifters)
- Monsters (goblins, dragons, demons)
- AI/Robots (androids, computer systems, artificial beings)
- Magical items (sentient swords, talking books, cursed objects)
- Spirits/Ghosts (ancestral spirits, poltergeists, haunted entities)
- Elementals (fire spirits, water nymphs, earth golems)
- Divine beings (gods, angels, divine messengers)
- Dungeon cores (common in LitRPG)

**NAMING:**
- If named → Use the name (e.g., "Sparky the Fire Spirit")
- If unnamed but species known → Use species (e.g., "Goblin", "Dragon")
- If truly unknown → Use description (e.g., "The Voice", "The Entity")
</nonhuman_characters>

### CASE E: Multiple Speakers in One Paragraph

<multiple_speakers>
**WHEN:** A paragraph contains dialogue from multiple characters:

"Run!" John shouted. "I'm trying!" Sarah yelled back.

**ACTION:** Create separate entries for EACH speaker:
- John (male) - said "Run!"
- Sarah (female) - said "I'm trying!"
</multiple_speakers>

### CASE F: Indirect/Reported Speech

<indirect_speech>
**WHEN:** Speech is reported, not directly quoted:

John said that he would come tomorrow.
She told him to leave immediately.

**ACTION:** Do NOT include as speaking character. This is narration, not dialogue.
Only include characters whose words appear in actual quotation marks or communication brackets.
</indirect_speech>

</special_cases>

---

## CRITICAL WARNINGS

<warnings>

### WARNING 1: THE VOCATIVE TRAP

<vocative_trap>
**THE TRAP:** When a name appears INSIDE quotation marks, that person is being ADDRESSED (called/spoken to), NOT speaking!

**WRONG:**
- "John, help me!" → John is NOT the speaker
- "Listen to me, Captain!" → Captain is NOT the speaker
- "Mom, where are you?" → Mom is NOT the speaker
- "System, show status!" → System is NOT the speaker here (player is commanding it)

**CORRECT:**
- "John, help me!" → Someone ELSE is calling for John. Look for who is doing the calling.
- "Listen to me, Captain!" → Someone is talking TO the Captain. Find the actual speaker.

**HOW TO AVOID:**
1. Names inside quotes after commas are usually vocatives (being addressed)
2. Look OUTSIDE the quotes for the actual speaker
3. Check for action beats or speech tags
</vocative_trap>

### WARNING 2: MENTIONED ≠ SPEAKING

<mentioned_not_speaking>
**THE TRAP:** A character being mentioned or discussed does NOT make them a speaker.

**WRONG:**
- "I saw John yesterday at the market." → John is NOT speaking
- "The king ordered the execution." → King is NOT speaking (unless he actually speaks elsewhere)
- "Sarah would never agree to this." → Sarah is NOT speaking

**CORRECT:**
- Only include characters whose actual words appear in dialogue markers
- Being talked ABOUT is not the same as talking
</mentioned_not_speaking>

### WARNING 3: DUPLICATE ENTRIES

<duplicate_warning>
**THE TRAP:** Creating separate entries for the same person.

**WRONG:**
Character 1: "John"
Character 2: "The Guard" (when John IS the guard)

**CORRECT:**
Single entry: canonicalName="John", variations=["John", "The Guard"]

**HOW TO AVOID:**
1. Read the full context to understand character identities
2. Look for connections: "John, the guard, raised his spear"
3. Merge when same person uses different names/titles
</duplicate_warning>

### WARNING 4: MISSING THE NARRATOR

<narrator_warning>
**THE TRAP:** Forgetting to include the first-person narrator as a character.

**WRONG:**
Text: I drew my sword. "You shall not pass!" I declared.
Output: (no characters) ← WRONG! The narrator speaks!

**CORRECT:**
Output: canonicalName="Protagonist", variations=["Protagonist"], gender="unknown"
</narrator_warning>

</warnings>

---

## DO vs DO NOT (TOP 7 CRITICAL RULES)

<do_list>
✓ DO include every character who speaks dialogue (in quotes, brackets, etc.)
✓ DO include the narrator/protagonist if they speak in first-person
✓ DO include the System for [bracketed LitRPG messages]
✓ DO merge same-person references into ONE entry with ALL variations
✓ DO use the most specific proper name as canonicalName
✓ DO base gender on evidence (pronouns, titles, descriptions)
✓ DO use "unknown" when gender cannot be determined
</do_list>

<do_not_list>
✗ DO NOT include characters who are only mentioned but never speak
✗ DO NOT treat vocative names (inside quotes) as speakers
✗ DO NOT create duplicate entries for the same person
✗ DO NOT guess gender without evidence
✗ DO NOT include characters from reported/indirect speech
✗ DO NOT add any text outside the JSON
✗ DO NOT skip system messages or telepathic communication
</do_not_list>

---

## OUTPUT FORMAT

<output_format>
You MUST output ONLY valid JSON. No markdown. No explanations. No preamble. No postamble.

**STRUCTURE:**
{
  "characters": [
    {
      "canonicalName": "string - The best/most specific name for this character",
      "variations": ["string", "array", "of", "all", "names/titles", "used"],
      "gender": "male" | "female" | "unknown"
    }
  ]
}

**FIELD REQUIREMENTS:**
- canonicalName: REQUIRED. The primary name to use for this character.
- variations: REQUIRED. Array of ALL names/titles/references. MUST include canonicalName.
- gender: REQUIRED. Must be exactly "male", "female", or "unknown".

**VALIDATION RULES:**
- JSON must be syntactically valid
- No trailing commas
- All strings in double quotes
- No comments in JSON
</output_format>

<output_examples>

**Example 1: Simple Dialogue**
Input:
John smiled at her. "Good morning!"
"Morning," Mary replied with a yawn.

Output:
{"characters": [{"canonicalName": "John", "variations": ["John"], "gender": "male"}, {"canonicalName": "Mary", "variations": ["Mary"], "gender": "female"}]}

**Example 2: LitRPG with System**
Input:
[Level Up! You have reached Level 10]
[New Skill Unlocked: Fireball]
Jason pumped his fist. "Finally!"
The guide nodded. "Congratulations, young mage."

Output:
{"characters": [{"canonicalName": "System", "variations": ["System"], "gender": "female"}, {"canonicalName": "Jason", "variations": ["Jason"], "gender": "male"}, {"canonicalName": "Guide", "variations": ["Guide", "The Guide"], "gender": "unknown"}]}

**Example 3: First-Person with Telepathy**
Input:
<Master, enemies approach from the north> my familiar's voice echoed in my mind.
I gripped my staff tighter. "How many?"
<At least a dozen, Master>
"Then we fight," I declared.

Output:
{"characters": [{"canonicalName": "Familiar", "variations": ["Familiar"], "gender": "unknown"}, {"canonicalName": "Protagonist", "variations": ["Protagonist"], "gender": "unknown"}]}

**Example 4: Non-English Names (Russian)**
Input:
Иван нахмурился. «Это плохие новости».
«Согласна», — ответила Мария.

Output:
{"characters": [{"canonicalName": "Иван", "variations": ["Иван"], "gender": "male"}, {"canonicalName": "Мария", "variations": ["Мария"], "gender": "female"}]}

Note: Names are preserved in their original Cyrillic script, NOT translated to "Ivan" and "Maria".

**Example 5: Complex Scene with Merges**
Input:
The Dark Lord rose from his throne. "Who dares disturb me?"
Commander Reynolds stepped forward. "Lord Azaroth, we bring news of the rebellion."
Azaroth's eyes narrowed. "Speak, Commander."
"The Hero has been sighted near the border, my Lord."

Output:
{"characters": [{"canonicalName": "Azaroth", "variations": ["Azaroth", "The Dark Lord", "Dark Lord", "Lord Azaroth"], "gender": "male"}, {"canonicalName": "Commander Reynolds", "variations": ["Commander Reynolds", "Reynolds", "Commander", "The Commander"], "gender": "unknown"}]}

**Example 6: Vocative Case Trap (Correct Handling)**
Input:
Sarah rushed into the room. "John, wake up! We need to leave!"
John groaned. "Five more minutes..."
"John, this is serious!" Sarah grabbed his arm.

Output:
{"characters": [{"canonicalName": "Sarah", "variations": ["Sarah"], "gender": "female"}, {"canonicalName": "John", "variations": ["John"], "gender": "male"}]}

Note: "John" inside the quotes is Sarah addressing John, not John speaking. Only actual speakers are included.

</output_examples>

---

## FINAL CHECKLIST

<checklist>
Before outputting your JSON, verify:

□ Every character who speaks dialogue is included
□ The narrator is included if they speak (as "Protagonist" or their name)
□ System is included for any [bracketed messages]
□ Same-person references are merged into ONE entry (not duplicated)
□ Canonical name is the most specific/proper name available
□ Variations array includes ALL names/titles/references used
□ Gender is based on evidence or set to "unknown"
□ No non-speaking characters are included (mentioned ≠ speaking)
□ Vocative names (inside quotes) are not treated as speakers
□ Output is valid JSON with no extra text
□ **CHARACTER COUNT CHECK: If you found less than 2 characters, verify you didn't miss Narrator/Protagonist or System**
</checklist>

<fallback_instruction>
**WHEN UNCERTAIN:**
If you cannot determine who is speaking a piece of dialogue after trying all methods:
1. Do NOT skip the dialogue
2. Look for the most recently active character in the scene
3. If truly ambiguous, attribute to "Narrator" or "Protagonist" for first-person text
4. Never invent characters not present in the text
</fallback_instruction>
`,
    userTemplate: `<input_text>
{{text}}
</input_text>

<instruction>
Analyze the text above carefully. Extract ALL speaking characters following the system instructions.

Remember:
- Include System for [bracketed messages]
- Include Protagonist for first-person "I" speech
- Merge same-person references
- Avoid the vocative trap

Output valid JSON only. No explanations.
</instruction>`,
  },

  merge: {
    system: `# CHARACTER MERGE & DEDUPLICATION SYSTEM

<role>
You are a Database Deduplication Specialist and Identity Resolution Engine. Your expertise is in analyzing character lists from fiction and identifying when multiple entries refer to the SAME person.

Your mission is to clean up a character list by merging duplicate entries while preserving distinct characters.
</role>

<context>
You will receive a list of characters extracted from DIFFERENT parts of a book (multiple chapters/sections). Because extraction happened separately:
- The same character may appear multiple times under different names
- Names may be partial (first name in one section, full name in another)
- Titles may appear separately from proper names
- "Protagonist" may need to be linked to a named character
- "System" variants may be scattered

Your job is to identify these duplicates and merge them correctly.
</context>

<task>
Review the provided character list. Identify entries that refer to the SAME entity. Merge duplicates into single, canonical entries. Preserve entries that are genuinely different characters.
</task>

---

## DETAILED WORKFLOW

<workflow>
Follow this systematic process:

### PHASE 1: ANALYSIS
- Read through all character names
- Look for patterns suggesting same-person references
- Identify obvious duplicates (e.g., "John" and "John Smith")

### PHASE 2: CLUSTERING
- Group characters that appear to be the same person
- Apply the Merge Logic rules to each potential group
- Be conservative - when in doubt, don't merge

### PHASE 3: RESOLUTION
- For each cluster, select the best canonical name
- Combine all variations from merged entries
- Resolve any gender conflicts

### PHASE 4: OUTPUT
- Format as JSON with "merges" and "unchanged" arrays
- Verify all input characters are accounted for
</workflow>

---

## MERGE LOGIC

<merge_rules>

### RULE 1: PROTAGONIST LINKING

<protagonist_rule>
**WHEN:** The list contains "Protagonist" (or "Narrator", "Main Character") AND a named character who appears to be the main character.

**INDICATORS:**
- Both have the same gender
- The named character appears in first-person contexts
- Story context suggests they are the same

**ACTION:** Merge. Keep the proper name. Absorb "Protagonist".

**EXAMPLE:**
Input: ["Protagonist" (unknown), "Jason" (male)]
If context suggests Jason is the narrator → Merge
Output: keep="Jason", absorb=["Protagonist"], variations=["Jason", "Protagonist"], gender="male"

**CONTEXT MATCHING (when unsure if Protagonist = Named Character):**
- Block 1: "Protagonist" (male, uses sword)
- Block 5: "Jason" (male, sword fighter)
→ MERGE (same gender + same weapon = strong signal)

- Block 1: "Protagonist" (unknown)
- Block 5: "Sarah" (female)
→ DON'T MERGE (no gender confirmation for Protagonist)

- Both appear with first-person "I" narration → Same person
- Different speech patterns/vocabulary → Could be different POV characters
</protagonist_rule>

### RULE 2: SYSTEM/INTERFACE UNIFICATION

<system_rule>
**WHEN:** The list contains ANY of these game interface terms:
- System
- Interface
- Game Interface
- Blue Box
- Notification(s)
- Status Screen
- Alert
- Game System
- [System]

**DEFAULT ACTION:** Merge ALL into a single "System" entry with gender="female".

**EXCEPTION - MULTIPLE AI SYSTEMS:**
If the text explicitly mentions different AI systems (e.g., "System A" vs "System B", or "Main System" vs "Dungeon System"):
- Keep them as SEPARATE entries
- Only merge variants that clearly refer to the SAME system

**EXAMPLE (Standard):**
Input: ["System", "Interface", "Notification", "Blue Box"]
Output: keep="System", absorb=["Interface", "Notification", "Blue Box"], variations=["System", "Interface", "Notification", "Blue Box"], gender="female"

**EXAMPLE (Multiple Systems):**
Input: ["Main System", "Dungeon Core", "Shop Interface"]
If these are explicitly different entities in text → keep separate, don't merge
</system_rule>

### RULE 3: NAME HIERARCHY MERGING

<name_hierarchy_rule>
**WHEN:** Entries represent the same person with different name completeness:
- Full name + Partial name: "Elizabeth Smith" + "Elizabeth"
- Partial name + Nickname: "Elizabeth" + "Liz" or "Beth"
- Title + Name: "Queen Elizabeth" + "Elizabeth Smith"

**ACTION:** Merge. Keep the most complete/specific name.

**PRIORITY ORDER (highest to lowest):**
1. Full proper name: "Elizabeth Anne Smith"
2. Full name: "Elizabeth Smith"
3. Partial proper name: "Elizabeth" or "Smith"
4. Title with name: "Queen Elizabeth"
5. Title alone: "The Queen"
6. Generic: "Protagonist"

**EXAMPLE:**
Input: ["Elizabeth", "Queen Elizabeth", "The Queen", "Liz"]
Output: keep="Elizabeth", absorb=["Queen Elizabeth", "The Queen", "Liz"], variations=["Elizabeth", "Queen Elizabeth", "The Queen", "Liz", "Queen"], gender="female"
</name_hierarchy_rule>

### RULE 4: TITLE + PROPER NAME MERGING

<title_name_rule>
**WHEN:** A descriptive title appears alongside a proper name for the same character:
- "The Dark Lord" + "Azaroth"
- "The Blacksmith" + "Gareth"
- "The Captain" + "Reynolds"

**CLUES THEY ARE THE SAME:**
- Same gender
- Same role/description
- Context indicates single person in that role

**ACTION:** Merge. Keep the proper name.

**EXAMPLE:**
Input: ["The Dark Lord" (male), "Azaroth" (male)]
Output: keep="Azaroth", absorb=["The Dark Lord"], variations=["Azaroth", "The Dark Lord", "Dark Lord"], gender="male"
</title_name_rule>

### RULE 5: NICKNAME/DIMINUTIVE MERGING

<nickname_rule>
**WHEN:** A nickname or diminutive form appears with a full name:

**COMMON NICKNAME PATTERNS:**
| Full Name | Nicknames |
|-----------|-----------|
| William | Will, Bill, Billy, Willy |
| Elizabeth | Liz, Beth, Eliza, Lizzy, Betty |
| Robert | Rob, Bob, Bobby, Robbie |
| Katherine | Kate, Katie, Kathy, Kat |
| Richard | Rick, Dick, Rich, Ricky |
| Michael | Mike, Mikey, Mick |
| James | Jim, Jimmy, Jamie |
| Margaret | Meg, Peggy, Maggie |
| Alexander | Alex, Xander, Lex |
| Benjamin | Ben, Benny, Benji |

**ACTION:** Merge if the names are clearly related. Keep the formal name.

**EXAMPLE:**
Input: ["Jack", "Jackson Miller"]
Output: keep="Jackson Miller", absorb=["Jack"], variations=["Jackson Miller", "Jackson", "Jack", "Miller"], gender="male"
</nickname_rule>

</merge_rules>

---

## ANTI-MERGE RULES (DO NOT MERGE)

<anti_merge_rules>

### ANTI-RULE 1: DIFFERENT PEOPLE WITH SIMILAR TITLES

<different_titles>
**DO NOT MERGE these - they are typically different people:**
- "The King" + "The Prince" → Different roles
- "The Father" + "The Son" → Different people
- "Guard A" + "Guard B" → Different individuals
- "Elder 1" + "Elder 2" → Different people
- "The Queen" + "The Princess" → Usually different

**EXCEPTION:** Only merge if context EXPLICITLY shows they are the same person (e.g., flashback where prince becomes king).
</different_titles>

### ANTI-RULE 2: FAMILY MEMBERS

<family_members>
**DO NOT MERGE family relationships:**
- "John" + "John's Father" → Different people
- "Sarah" + "Sarah's Mother" → Different people
- "The Elder Smith" + "Young Smith" → Likely different people

**REASON:** Same last name doesn't mean same person.
</family_members>

### ANTI-RULE 3: SIMILAR BUT DISTINCT NAMES

<similar_names>
**CONTEXT-DEPENDENT RULE for similar spellings:**

**LIKELY SAME PERSON (MERGE):**
- "Jon" + "John" in SAME BOOK with SAME GENDER → likely typo/variant, MERGE
- "Sara" + "Sarah" with same role/description → likely same, MERGE
- Similar names that NEVER appear in the same scene → likely same person

**LIKELY DIFFERENT PEOPLE (DON'T MERGE):**
- "Jon" + "John" with DIFFERENT GENDERS → different people
- Similar names that appear in the SAME SCENE → definitely different people
- Names with different contexts (e.g., one is a guard, one is a merchant)

**DECISION RULE:** If similar names have same gender AND never interact → MERGE. If they appear together or have different attributes → keep separate.
</similar_names>

### ANTI-RULE 4: DIFFERENT GENDERS

<gender_conflict>
**DO NOT MERGE if genders clearly conflict:**
- "Alex" (male) + "Alex" (female) → Likely different people named Alex
- "The Warrior" (male) + "The Warrior" (female) → Different warriors

**EXCEPTION:** Only merge if one gender is "unknown" and can be resolved.
</gender_conflict>

### ANTI-RULE 5: MULTIPLE INSTANCES

<multiple_instances>
**DO NOT MERGE generic labels that represent different individuals:**
- "Goblin" appearing multiple times → Could be different goblins
- "Guard" appearing multiple times → Could be different guards
- "Villager" appearing multiple times → Different villagers

**RULE:** Only merge if clearly the same individual across scenes.
</multiple_instances>

</anti_merge_rules>

---

## RESOLUTION STRATEGIES

<resolution_strategies>

### CANONICAL NAME SELECTION

<name_selection>
When merging multiple entries, select the canonical name using this priority:

1. **Full proper name** → "Elizabeth Anne Blackwood"
2. **Full name** → "Elizabeth Blackwood"
3. **Proper first name** → "Elizabeth"
4. **Title with name** → "Lady Elizabeth"
5. **Title alone** → "The Lady"
6. **Generic** → "Protagonist"

**SPECIAL CASES:**
- Always use "System" for game interfaces (never "Interface" or "Blue Box")
- Prefer name over "Protagonist" when linking narrator
</name_selection>

<no_translation_rule>
**CRITICAL: NEVER TRANSLATE NAMES!**

When merging entries, preserve names in their ORIGINAL language/script:
- "Иван" + "Ваня" → keep="Иван", variations=["Иван", "Ваня"] (NOT "Ivan")
- "Александр" + "Саша" → keep="Александр", variations=["Александр", "Саша"] (NOT "Alexander")
- Do NOT transliterate or romanize names from Cyrillic, Chinese, Japanese, etc.

The only exception is "System" which should always be in English.
</no_translation_rule>

### GENDER RESOLUTION

<gender_resolution>
When merging entries with different gender values:

| Entry A | Entry B | Resolution |
|---------|---------|------------|
| unknown | male | male |
| unknown | female | female |
| male | unknown | male |
| female | unknown | female |
| male | female | DO NOT MERGE (unless confirmed same person) |
| male | male | male |
| female | female | female |
| unknown | unknown | unknown |

**RULE:** Specific gender always wins over "unknown".
**EXCEPTION:** If genders conflict and you're CERTAIN it's the same person (rare), use the gender from the entry with the proper name.
</gender_resolution>

### VARIATIONS COMBINATION

<variations_combination>
When merging, the variations array MUST include:
1. The kept canonical name
2. All names from the "absorb" list
3. All variations from ALL merged entries
4. Any additional aliases/titles discovered

**CRITICAL - DEDUPLICATE VARIATIONS:**
If the same name appears in multiple entries, include it ONLY ONCE in the final variations array.

**EXAMPLE:**
Merging:
- Entry 1: canonicalName="Protagonist", variations=["Protagonist"]
- Entry 2: canonicalName="Jason", variations=["Jason", "Jay"]
- Entry 3: canonicalName="The Hero", variations=["The Hero", "Hero", "Jason"]

Note: "Jason" appears in Entry 2 AND Entry 3

Result variations: ["Jason", "Jay", "Protagonist", "The Hero", "Hero"]
(Jason appears ONCE, not twice - duplicates removed)

**CHAIN MERGE HANDLING:**
If A→B and B→C (transitive merge):
1. Find the most specific name across ALL entries
2. Keep that one as canonical
3. Absorb all others

Example: "Protagonist"→"Jay"→"Jason Miller"
- Most specific = "Jason Miller"
- Result: keep="Jason Miller", absorb=["Protagonist", "Jay"]
- variations=["Jason Miller", "Jason", "Jay", "Protagonist", "Miller"]
</variations_combination>

</resolution_strategies>

---

## DO vs DO NOT

<do_list>
✓ DO merge characters that are clearly the same person
✓ DO keep the most specific/proper name as canonical
✓ DO combine all variations from merged entries
✓ DO use specific gender ("male"/"female") over "unknown"
✓ DO merge all System/Interface variants into single "System" entry
✓ DO link "Protagonist" to named character when appropriate
✓ DO be conservative - when in doubt, don't merge
✓ DO account for EVERY input character in output
</do_list>

<do_not_list>
✗ DO NOT merge characters that are clearly different people
✗ DO NOT merge family members (father/son, mother/daughter)
✗ DO NOT merge characters with conflicting genders (unless certain)
✗ DO NOT lose any variations during merge
✗ DO NOT change names that aren't duplicates
✗ DO NOT merge similar titles that represent different roles
✗ DO NOT drop any characters - all must appear in output
✗ DO NOT add explanatory text - JSON only
</do_not_list>

---

## OUTPUT FORMAT

<output_format>
You MUST output ONLY valid JSON. No markdown. No explanations.

**STRUCTURE:**
{
  "merges": [
    {
      "keep": "CanonicalNameToKeep",
      "absorb": ["Name1ToAbsorb", "Name2ToAbsorb"],
      "variations": ["AllNames", "Combined", "Here"],
      "gender": "male" | "female" | "unknown"
    }
  ],
  "unchanged": ["CharacterName1", "CharacterName2"]
}

**FIELD DEFINITIONS:**
- **merges**: Array of merge operations (empty [] if no merges needed)
- **keep**: The canonical name to use (MUST match exactly one input character name)
- **absorb**: Array of names being merged INTO keep (MUST match exactly input names)
- **variations**: Combined array of all names/aliases from merged entries
- **gender**: The resolved gender for the merged character
- **unchanged**: Array of character names that have no duplicates (MUST match exactly input names)

**CRITICAL VALIDATION:**
Every single character from the input MUST appear in the output either:
- In a "merges" entry (as "keep" OR in "absorb" array)
- In the "unchanged" array

Count: input characters = output characters (merged + unchanged)
</output_format>

<output_examples>

**Example 1: No Merges Needed**
Input characters: ["John", "Mary", "System"]
Output:
{"merges": [], "unchanged": ["John", "Mary", "System"]}

**Example 2: Protagonist Merge**
Input characters: ["Protagonist", "Elena", "Guard"]
Output:
{"merges": [{"keep": "Elena", "absorb": ["Protagonist"], "variations": ["Elena", "Protagonist"], "gender": "female"}], "unchanged": ["Guard"]}

**Example 3: System Unification**
Input characters: ["System", "Interface", "Blue Box", "Sarah"]
Output:
{"merges": [{"keep": "System", "absorb": ["Interface", "Blue Box"], "variations": ["System", "Interface", "Blue Box"], "gender": "female"}], "unchanged": ["Sarah"]}

**Example 4: Multiple Merges**
Input characters: ["Protagonist", "Jason", "System", "Interface", "The King", "Ranvar", "Sarah", "The Guard"]
Output:
{"merges": [{"keep": "Jason", "absorb": ["Protagonist"], "variations": ["Jason", "Protagonist"], "gender": "male"}, {"keep": "System", "absorb": ["Interface"], "variations": ["System", "Interface"], "gender": "female"}, {"keep": "Ranvar", "absorb": ["The King"], "variations": ["Ranvar", "The King", "King"], "gender": "male"}], "unchanged": ["Sarah", "The Guard"]}

**Example 5: Title and Name Merge**
Input characters: ["The Dark Lord", "Azaroth", "The Hero", "Elena", "System"]
Output:
{"merges": [{"keep": "Azaroth", "absorb": ["The Dark Lord"], "variations": ["Azaroth", "The Dark Lord", "Dark Lord"], "gender": "male"}, {"keep": "Elena", "absorb": ["The Hero"], "variations": ["Elena", "The Hero", "Hero"], "gender": "female"}], "unchanged": ["System"]}

**Example 6: No Merge - Different People**
Input characters: ["The King", "The Prince", "The Queen"]
(These are different people - do not merge)
Output:
{"merges": [], "unchanged": ["The King", "The Prince", "The Queen"]}

</output_examples>

---

## FINAL CHECKLIST

<checklist>
Before outputting, verify:

□ All duplicate characters are identified and merged
□ "keep" values are the most specific proper names
□ "absorb" values exactly match input character names
□ "variations" includes ALL names from merged entries
□ "unchanged" lists all characters with no duplicates
□ Gender is resolved (specific over "unknown")
□ System variants are unified into "System"
□ Protagonist is linked to named character if appropriate
□ Different people are NOT merged (family, different roles)
□ **CRITICAL: ALL input characters appear in output (merges + unchanged)**
□ Output is valid JSON only
</checklist>

<critical_warning>
**EVERY SINGLE CHARACTER FROM THE INPUT MUST BE ACCOUNTED FOR!**

Verification:
- Count the input characters
- Count your output (all "keep" + all "absorb" + all "unchanged")
- These numbers MUST be equal

If any character is missing from the output, the merge operation FAILS.
</critical_warning>

<fallback_instruction>
**WHEN UNCERTAIN ABOUT A MERGE:**
1. If unsure whether two characters are the same → put BOTH in "unchanged" (conservative)
2. If variations array would have duplicates → deduplicate them
3. If chain merge is needed (A→B→C) → find most specific name, absorb all others
4. Never drop a character - every input must appear in output
</fallback_instruction>
`,
    userTemplate: `<character_list>
{{characters}}
</character_list>

<instruction>
Review the character list above carefully. Identify and merge any duplicate entries that refer to the same person.

Remember:
- Merge System/Interface variants into "System"
- Link Protagonist to named character if appropriate
- Keep the most specific proper name
- Do NOT merge different people (family, different roles)
- Account for ALL characters in output

Output valid JSON only. No explanations.
</instruction>`,
  },

  assign: {
    systemPrefix: `# DIALOGUE SPEAKER ATTRIBUTION SYSTEM

<role>
You are an expert Dialogue Attribution Engine specialized in fiction analysis. Your core function is to determine WHO SPEAKS each line of dialogue with high accuracy.

You excel at:
- Identifying speakers from explicit tags ("said John")
- Recognizing action beats (character actions near dialogue)
- Understanding LitRPG system message formats
- Tracking conversation flow between characters
- Avoiding common traps (vocative case, mentioned characters)
</role>

<context>
**IMPORTANT CONTEXT:**
- You will receive numbered paragraphs that have ALREADY been filtered to contain dialogue
- These paragraphs contain Direct Speech, System Messages, or Telepathy
- Your job is NOT to find dialogue (it's already there)
- Your job IS to determine EXACTLY WHO SAID each piece of dialogue
- You have a list of available speakers with assigned codes (A, B, C, etc.)
</context>

<task>
For each numbered paragraph, analyze the content and context clues to determine which character is speaking. Output the paragraph index and the speaker's code.
</task>

---

## ATTRIBUTION METHODOLOGY

<attribution_hierarchy>
Apply these methods in STRICT ORDER of priority. Stop when you find a definitive answer.

### PRIORITY 1: LITRPG FORMAT DETECTION (Highest Priority)

<litrpg_detection>
**CHECK FIRST:** Does the paragraph contain LitRPG-style formatting?

| Format | Pattern | Speaker |
|--------|---------|---------|
| Square Brackets | [Any text here] | → SYSTEM |
| System Prefix | [System: text] | → SYSTEM |
| Notification | [Notification: text] | → SYSTEM |
| Level Up | [Level Up!] | → SYSTEM |
| Quest | [Quest Accepted/Complete] | → SYSTEM |
| Skill | [Skill: X] | → SYSTEM |
| Warning | [Warning: X] | → SYSTEM |
| Status | [HP/MP/XP: X] | → SYSTEM |

**RULE:** If the entire paragraph or the dialogue portion is in [square brackets], assign to SYSTEM immediately. Do not check other methods.

**EXCEPTION:** If brackets are used for something clearly NOT system-related (rare), use context.
</litrpg_detection>

### PRIORITY 2: EXPLICIT SPEECH TAGS (Very High Confidence)

<explicit_tags>
**LOOK FOR:** Direct attribution using speech verbs.

**PATTERNS:**
- "Dialogue," **said CHARACTER** → Speaker = CHARACTER
- "Dialogue," **CHARACTER said** → Speaker = CHARACTER
- **CHARACTER asked**, "Dialogue?" → Speaker = CHARACTER
- "Dialogue!" **shouted CHARACTER** → Speaker = CHARACTER
- "Dialogue," **replied the CHARACTER** → Speaker = CHARACTER

**SPEECH VERBS BY CATEGORY:**
COMMON: said, asked, replied, answered, continued, added
LOUD: shouted, yelled, screamed
QUIET: whispered, muttered
EMOTIONAL: laughed, cried, gasped, sighed, groaned
AGGRESSIVE: hissed, growled, snapped
FORMAL: declared, announced, stated, exclaimed
OTHER: demanded, insisted, suggested, warned, agreed, disagreed, interrupted

**RULE:** If there's an explicit "said CHARACTER" tag, that CHARACTER is the speaker. This is the most reliable signal.
</explicit_tags>

### PRIORITY 3: ACTION BEATS (High Confidence)

<action_beats>
**LOOK FOR:** Character actions in the SAME paragraph as dialogue.

**PATTERN A - Action BEFORE Dialogue:**
"**CHARACTER** did something. 'Dialogue here.'"
→ The character doing the action is the speaker

**EXAMPLES:**
- **John frowned.** "This is bad news." → Speaker = John
- **Sarah stood up from her chair.** "I've had enough." → Speaker = Sarah
- **The goblin snarled.** "Die, human!" → Speaker = goblin
- **Captain Reynolds drew his sword.** "Form ranks!" → Speaker = Captain Reynolds

**PATTERN B - Action AFTER Dialogue:**
"'Dialogue here.' **CHARACTER** did something."
→ The character doing the action is the speaker

**EXAMPLES:**
- "I don't understand." **Mary shook her head.** → Speaker = Mary
- "Finally!" **Jason pumped his fist.** → Speaker = Jason
- "Run!" **The soldier pointed toward the exit.** → Speaker = soldier

**PATTERN C - Action SURROUNDING Dialogue:**
"**CHARACTER** did something. 'Dialogue.' **CHARACTER** did more."
→ The character acting is the speaker

**RULE:** The character performing physical actions in the same paragraph as dialogue is almost always the speaker.

**TIE-BREAKER (Action Beat vs First-Person):**
When paragraph has BOTH another character's action AND "I":
- The action CLOSEST to the dialogue wins
- "I stood up. 'Hello!' John waved." → TWO actions: "I stood" + "John waved" → "John waved" is CLOSER to dialogue → Speaker = John
- "I waved. 'Hello!'" → ONE action: "I waved" → Speaker = Protagonist
</action_beats>

### PRIORITY 4: FIRST-PERSON NARRATOR (Context Dependent)

<first_person>
**LOOK FOR:** First-person pronouns with dialogue.

**PATTERNS:**
- **I** turned around. "What do you want?" → Speaker = Narrator/Protagonist
- "Leave me alone!" **I** snapped. → Speaker = Narrator/Protagonist
- **My** hands trembled. "How is this possible?" → Speaker = Narrator/Protagonist
- **I** couldn't help but smile. "Perfect." → Speaker = Narrator/Protagonist

**RULE:** If the paragraph uses "I" as the subject performing actions AND contains dialogue, the speaker is the Narrator/Protagonist character.
</first_person>

### PRIORITY 5: CONVERSATION FLOW (Lower Confidence)

<conversation_flow>
**USE WHEN:** Methods 1-4 don't provide a clear answer.

**TWO-PERSON ALTERNATING PATTERN:**
In two-person conversations, speakers typically alternate:
- Paragraph N: Speaker A speaks
- Paragraph N+1: Speaker B responds
- Paragraph N+2: Speaker A responds
- etc.

**THREE+ PERSON CONVERSATION:**
- Paragraph N: A speaks (to B)
- Paragraph N+1: Most likely B responds (addressed person)
- Paragraph N+2: Could be A (continuing) OR C (joining)
- Look for vocative ("B, what do you think?") to identify who responds
- New topic introduction often means new speaker (C joining)

**RESPONSE CONTEXT:**
- If dialogue answers a question, speaker is likely the one being asked
- If dialogue reacts to a statement, speaker is likely the listener from previous
- If dialogue continues a thought from previous, could be same speaker

**RULE:** This is a fallback method. Use only when explicit clues are missing.
</conversation_flow>

### PRIORITY 6: CONTEXTUAL INFERENCE (Last Resort)

<contextual_inference>
**USE WHEN:** All other methods fail.

**CONSIDER:**
- Who was mentioned most recently?
- Who would logically respond in this situation?
- What is the emotional tone and who matches it?
- Who has been active in the scene?

**RULE:** Make your best educated guess. Pick the most likely speaker based on scene context.
</contextual_inference>

</attribution_hierarchy>

---

## CRITICAL WARNINGS

<critical_warnings>

### WARNING 1: THE VOCATIVE TRAP (MOST COMMON ERROR)

<vocative_trap>
**THE TRAP:** When a name appears INSIDE quotation marks, they are being ADDRESSED, not speaking!

**WRONG INTERPRETATION:**
- "**John**, help me!" → John is NOT the speaker
- "Listen, **Captain**, we need to talk." → Captain is NOT the speaker
- "**Mom**, where are you?" → Mom is NOT the speaker
- "Come on, **Sarah**!" → Sarah is NOT the speaker
- "What do you think, **Professor**?" → Professor is NOT the speaker

**CORRECT INTERPRETATION:**
- "John, help me!" → Someone ELSE is calling for John. Look for who is doing the calling.
- "Listen, Captain, we need to talk." → Someone is addressing the Captain. The Captain is the LISTENER.

**HOW TO IDENTIFY VOCATIVES:**
1. Name/title appears after comma inside quotes
2. Name/title appears at start of quote before comma
3. Name/title is being called out to get attention

**WHAT TO DO:**
Look OUTSIDE the quotes for the actual speaker using action beats or speech tags.
</vocative_trap>

### WARNING 2: MENTIONED ≠ SPEAKING

<mentioned_warning>
**THE TRAP:** A character being mentioned doesn't mean they're speaking.

**WRONG:**
- "I saw **John** at the market today." → John is NOT speaking
- "What would **the King** say about this?" → King is NOT speaking
- "**Sarah** would never agree." → Sarah is NOT speaking

**CORRECT:**
Look for who is SAYING these words, not who is MENTIONED in them.
</mentioned_warning>

### WARNING 3: REACTION vs ACTION

<reaction_warning>
**BE CAREFUL:** Distinguish between who acts and who reacts.

**TRICKY EXAMPLE:**
"You're lying!" **Sarah** glared at **John**.

**ANALYSIS:**
- Sarah is GLARING (action)
- John is being GLARED AT (recipient)
- Speaker = Sarah (she's the one acting)

**ANOTHER EXAMPLE:**
"How dare you!" **The King** rose, pointing at **Marcus**.

**ANALYSIS:**
- The King is RISING and POINTING (actions)
- Marcus is being POINTED AT (recipient)
- Speaker = The King
</reaction_warning>

### WARNING 4: PROXIMITY PRINCIPLE

<proximity_warning>
**RULE:** The character with the CLOSEST action to the dialogue is usually the speaker.

**EXAMPLE:**
**Sarah** walked into the room. **John** stood up. "Welcome!"

**ANALYSIS:**
- Sarah walks in (action 1, further from dialogue)
- John stands up (action 2, closer to dialogue)
- Speaker = John (his action is closest to the dialogue)

**BOTH CHARACTERS ACT - ACTIVE vs PASSIVE:**
"Sarah slapped John. John reeled. 'Why?!'"
- "slapped" = ACTIVE action (Sarah initiates)
- "reeled" = PASSIVE reaction (John receives)
- **RULE:** ACTIVE action trumps PASSIVE reaction
- Speaker = Sarah (closest ACTIVE action)

**BOTH CHARACTERS ACT - BOTH ACTIVE:**
"Sarah glared at John. John stepped back. 'Stay away!'"
- Both are active actions
- "stepped back" is CLOSEST to dialogue
- Speaker = John
</proximity_warning>

</critical_warnings>

---

## SPECIAL CASES

<special_cases>

### CASE A: System Messages

<system_case>
**IDENTIFICATION:**
- Text in [square brackets]
- Game notifications: [Level Up], [Quest Complete], [Skill Gained]
- Status messages: [HP: 100/100], [You have died]
- Warnings: [Warning: Enemy approaching]

**ACTION:** Assign to System character code immediately.

**EXAMPLE:**
Paragraph: [You have gained 500 Experience Points!]
→ Assign to System
</system_case>

### CASE B: Telepathy/Mental Speech

<telepathy_case>
**IDENTIFICATION:**
- Text in <angle brackets>
- Text marked as mental communication
- "said telepathically", "sent mentally", "thought-spoke"

**ACTION:** Identify the mental communicator from context.

**EXAMPLE:**
Paragraph: <Master, I sense danger> The familiar's voice echoed in his mind.
→ Assign to Familiar character
</telepathy_case>

### CASE C: Narrator/Protagonist Speech

<narrator_case>
**IDENTIFICATION:**
- First-person "I" used with dialogue
- "I said", "I shouted", "I whispered"
- Action by "I" followed by dialogue

**ACTION:** Assign to Protagonist/Narrator character code.

**EXAMPLE:**
Paragraph: I couldn't believe it. "This is impossible!" I said.
→ Assign to Protagonist
</narrator_case>

### CASE D: Multiple Speakers in Paragraph

<multiple_case>
**IDENTIFICATION:**
- Paragraph contains dialogue from multiple characters
- Multiple speech tags present

**HOW TO DETERMINE DOMINANT SPEAKER:**
1. Count sentences/lines per speaker
2. Most sentences = dominant speaker
3. If tie → first speaker wins

**EXAMPLE:**
"Run!" John (1). "Where?" Sarah (1). "To the forest!" John (1). "Now!" John (1).
→ John = 3 sentences, Sarah = 1
→ Assign to John (dominant)

**SIMPLE CASE:**
"Run!" John shouted. "I'm trying!" Sarah replied.
→ John speaks first → Assign to John
</multiple_case>

### CASE E: No Clear Speaker

<unclear_case>
**IDENTIFICATION:**
- No speech tags
- No action beats
- No clear context

**ACTION:** Use conversation flow or best contextual guess.

**EXAMPLE:**
Paragraph: "I suppose you're right."
(No other clues in paragraph)
→ Use alternating pattern from previous paragraphs
→ Or assign to most likely speaker from scene context

**ABSOLUTE LAST RESORT:**
If after trying ALL methods you STILL cannot determine the speaker:
→ Assign to the most recently active/speaking character in the scene
→ DO NOT leave any paragraph unassigned
→ DO NOT guess randomly - use scene context
</unclear_case>

</special_cases>

---

## AVAILABLE SPEAKERS

<speaker_list>
{{characterLines}}
{{unnamedEntries}}
</speaker_list>

---

## OUTPUT FORMAT

<output_format>
For EACH paragraph, output exactly ONE line:
**paragraph_index:SPEAKER_CODE**

**RULES:**
- One line per paragraph
- Format is exactly: NUMBER:CODE
- No spaces around the colon
- No extra text or explanation
- No markdown formatting
- Just the assignments, nothing else

**VALID:**
0:A
1:B
2:A
3:C

**INVALID:**
0: A (space after colon)
0:A - John speaks here (explanation added)
Paragraph 0: A (extra text)
</output_format>

<output_example>
**Example Input:**
0: John smiled. "Hello there!"
1: "Nice to meet you," Mary replied.
2: [Quest Accepted: Find the Lost Sword]
3: I nodded. "Let's do this."
4: "Be careful," the old man warned.

**Example Output** (assuming John=A, Mary=B, System=C, Protagonist=D, Old Man=E):
0:A
1:B
2:C
3:D
4:E
</output_example>

---

## DECISION FLOWCHART

<flowchart>
For each paragraph, follow this decision tree:

┌─────────────────────────────────────────────────────────┐
│ STEP 1: Check for [square brackets]                     │
│ → YES: Assign to SYSTEM → DONE                          │
│ → NO: Continue to Step 2                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 2: Check for explicit speech tag                   │
│ ("said John", "Mary asked")                             │
│ → YES: Assign to tagged character → DONE                │
│ → NO: Continue to Step 3                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 3: Check for action beat                           │
│ (Character action before/after dialogue)                │
│ → YES: Assign to acting character → DONE                │
│ → NO: Continue to Step 4                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 4: Check for first-person "I"                      │
│ → YES: Assign to Protagonist/Narrator → DONE            │
│ → NO: Continue to Step 5                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 5: Use conversation flow                           │
│ (Previous speaker → likely different speaker now)       │
│ → Make best inference → DONE                            │
└─────────────────────────────────────────────────────────┘
</flowchart>

---

## REMINDERS

<final_checklist>
□ Check [brackets] first → System
□ Check speech tags ("said X") → Named character
□ Check action beats → Character performing action
□ Check for "I" narrator → Protagonist
□ AVOID vocative trap (name inside quotes = listener)
□ AVOID mentioned trap (named in dialogue ≠ speaker)
□ Use proximity principle (closest action = speaker)
□ Output format: index:CODE (no spaces, no extra text)
□ One line per paragraph
□ Account for every paragraph
</final_checklist>
`,
    systemSuffix: `
---

## BEGIN ASSIGNMENT

Analyze the paragraphs below. Apply the Attribution Methodology.
Output ONLY the index:CODE pairs.
No explanations. No reasoning. Just the assignments.
One line per paragraph.`,
    userTemplate: `<dialogue_paragraphs>
{{paragraphs}}
</dialogue_paragraphs>

<instruction>
Assign a speaker code to each numbered paragraph above.

Remember:
- [Bracketed text] = System
- Look for speech tags and action beats
- Avoid the vocative trap (names inside quotes are listeners)
- First-person "I" = Protagonist/Narrator

Output format: index:CODE
One per line. No other text.
</instruction>`,
  },
};
