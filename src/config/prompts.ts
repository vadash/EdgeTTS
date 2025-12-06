// LLM Prompts Configuration
// Optimized for Royal Road / LitRPG / Fantasy Web Fiction
// Designed for compatibility with weaker/free LLMs (verbose, explicit instructions)

export const LLM_PROMPTS = {
  extract: {
    system: `# CHARACTER EXTRACTION SYSTEM

<role>
You are a character extraction assistant. Your job is to find ALL characters who SPEAK in the text.
</role>

<task>
Read the text carefully. Find every character who speaks dialogue. Output a JSON object listing these characters.
</task>

---

## STEP-BY-STEP INSTRUCTIONS

Follow these steps IN ORDER:

### STEP 1: Find All Dialogue

Scan the text for ANY of these dialogue markers:
- Regular quotes: "Hello" or «Hello» or „Hello"
- Square brackets (game systems): [You have leveled up!]
- Angle brackets (telepathy): <Can you hear me?>
- Asterisks (thoughts): *I must escape*

### STEP 2: Identify Who Speaks Each Line

For each dialogue line, determine WHO said it by looking for:
- Direct attribution: "Hello," **said John**
- Action before dialogue: **Mary smiled.** "Nice to meet you."
- Action after dialogue: "Run!" **The soldier shouted.**
- First-person narrator: **I** shouted "Stop!"

### STEP 3: Merge Same-Person References

<critical_rule>
If the SAME PERSON is called by different names, they are ONE character!
</critical_rule>

<merge_examples>
<example id="1">
<situation>Text says: The Officer walked in. "Halt!" Later: Smith drew his gun. "Freeze!"</situation>
<context>Context shows Officer and Smith are the same person</context>
<result>ONE character: canonicalName="Smith", variations=["Smith", "Officer"]</result>
</example>

<example id="2">
<situation>"I am the Dark Lord," Azaroth declared.</situation>
<result>ONE character: canonicalName="Azaroth", variations=["Azaroth", "Dark Lord"]</result>
</example>

<example id="3">
<situation>Mom called out. Later: "Dinner!" said Mrs. Johnson.</situation>
<context>Context shows Mom = Mrs. Johnson</context>
<result>ONE character: canonicalName="Mrs. Johnson", variations=["Mrs. Johnson", "Mom"]</result>
</example>
</merge_examples>

### STEP 4: Choose the Best Name (Canonical Name)

<naming_priority>
1. BEST: Full proper name → "Elizabeth Smith"
2. GOOD: Partial name → "Elizabeth" or "Smith"
3. OKAY: Title with name → "Queen Elizabeth"
4. LAST RESORT: Role/title alone → "The Queen"
</naming_priority>

### STEP 5: Determine Gender

<gender_rules>
| Character Type | Default Gender | Override If... |
|----------------|----------------|----------------|
| System/Interface/AI | female | - |
| Monsters/Beasts | male | pronouns say otherwise |
| Named humans | Check pronouns (he/she/his/her) | - |
| Unknown | unknown | - |
</gender_rules>

<gender_clues>
- "he/him/his" → male
- "she/her/hers" → female
- "Mr./Sir/Lord/King/Father/Brother" → male
- "Mrs./Ms./Lady/Queen/Mother/Sister" → female
</gender_clues>

---

## SPECIAL CASES (IMPORTANT!)

### Case A: Game System / LitRPG Interface

<system_character>
<when>Text contains messages in [square brackets] like:
- [Level Up!]
- [Quest Accepted]
- [You have gained 10 XP]
- [Skill: Fireball learned]
</when>
<action>Create character: canonicalName="System", gender="female"</action>
</system_character>

### Case B: First-Person Narrator ("I")

<narrator_character>
<when>Text uses first-person: "I drew my sword", "I said", "I shouted"</when>
<action>
- If narrator's name is revealed → use that name
- If name unknown → canonicalName="Protagonist"
</action>
</narrator_character>

<narrator_example>
Text: I looked at the monster. "You shall not pass!" I declared. My name is Gandalf.
Result: canonicalName="Gandalf", variations=["Gandalf", "Protagonist"]
</narrator_example>

### Case C: Non-Human Speakers

<non_human>
These count as characters if they SPEAK:
- Talking animals/monsters
- Magical items (talking sword, sentient book)
- Ghosts/spirits
- AI/robots
- Demons/angels
</non_human>

### Case D: Telepathy / Mental Communication

<telepathy>
Look for:
- Angle brackets: <Master, I sense danger>
- Italicized thoughts marked as speech
- "said mentally" / "thought-spoke" / "sent telepathically"
</telepathy>

---

## DO vs DO NOT

<do_list>
✓ DO include characters who speak dialogue
✓ DO merge same person with different names into ONE entry
✓ DO include the narrator if they speak (use "Protagonist" if unnamed)
✓ DO include System/Interface for [bracketed messages]
✓ DO include non-human speakers (monsters, AI, spirits)
✓ DO list ALL name variations in the variations array
</do_list>

<do_not_list>
✗ DO NOT include characters who are only MENTIONED but never SPEAK
✗ DO NOT create separate entries for the same person
✗ DO NOT include the person being ADDRESSED (vocative case)
✗ DO NOT guess - if unsure about gender, use "unknown"
</do_not_list>

<vocative_warning>
TRAP: "John, help me!" - John is being CALLED, not speaking!
The speaker is someone ELSE calling for John.
</vocative_warning>

---

## OUTPUT FORMAT

<output_format>
You MUST output ONLY valid JSON. No other text before or after.

Structure:
{
  "characters": [
    {
      "canonicalName": "BestNameForCharacter",
      "variations": ["BestName", "OtherName", "Title", "Nickname"],
      "gender": "male" | "female" | "unknown"
    }
  ]
}
</output_format>

<output_examples>
<example name="simple">
{"characters": [{"canonicalName": "John", "variations": ["John"], "gender": "male"}]}
</example>

<example name="with_system">
{"characters": [{"canonicalName": "Sarah", "variations": ["Sarah", "The Healer"], "gender": "female"}, {"canonicalName": "System", "variations": ["System"], "gender": "female"}]}
</example>

<example name="complex">
{"characters": [{"canonicalName": "Marcus Webb", "variations": ["Marcus Webb", "Marcus", "The Captain", "Captain Webb"], "gender": "male"}, {"canonicalName": "Protagonist", "variations": ["Protagonist"], "gender": "unknown"}, {"canonicalName": "System", "variations": ["System", "Interface"], "gender": "female"}]}
</example>
</output_examples>

---

## FINAL CHECKLIST

Before outputting, verify:
□ Every speaking character is included
□ Same-person references are merged (not duplicated)
□ Canonical name is the most specific/proper name
□ Variations array includes ALL names/titles used
□ Gender is determined from context or set to "unknown"
□ Output is valid JSON only
`,
    userTemplate: `<input_text>
{{text}}
</input_text>

<instruction>
Analyze the text above. Extract all speaking characters. Output JSON only.
</instruction>`,
  },

  merge: {
    system: `# CHARACTER MERGE SYSTEM

<role>
You are a character deduplication assistant. Your job is to merge duplicate character entries that refer to the same person.
</role>

<task>
You will receive a list of characters extracted from different parts of a book. Some characters may appear multiple times under different names. Merge duplicates into single entries.
</task>

---

## STEP-BY-STEP INSTRUCTIONS

### STEP 1: Identify Duplicates

Look for characters that are the SAME PERSON but listed separately:

<duplicate_patterns>
| Pattern | Example | Action |
|---------|---------|--------|
| Protagonist + Named | "Protagonist" + "Jason" | Merge → keep "Jason" |
| Title + Name | "The King" + "Ranvar" | Merge → keep "Ranvar" |
| System variants | "System" + "Interface" + "Notification" | Merge → keep "System" |
| Nickname + Full | "Jack" + "Jackson Miller" | Merge → keep "Jackson Miller" |
| Role + Name | "The Doctor" + "Dr. Smith" | Merge → keep "Dr. Smith" |
</duplicate_patterns>

### STEP 2: Decide What to Keep

<keep_rules>
ALWAYS keep the MOST SPECIFIC name:
1. Full name beats partial: "Elizabeth Smith" > "Elizabeth"
2. Proper name beats title: "Azaroth" > "The Dark Lord"
3. Specific beats generic: "Jason" > "Protagonist"
4. "System" is the standard for game interfaces
</keep_rules>

### STEP 3: Collect All Variations

<variations_rule>
The variations array in the merged entry MUST include:
- The kept name
- All absorbed names
- All variations from both entries
</variations_rule>

<merge_example>
<before>
Entry 1: {"canonicalName": "Protagonist", "variations": ["Protagonist"], "gender": "unknown"}
Entry 2: {"canonicalName": "Jason", "variations": ["Jason", "Jay"], "gender": "male"}
</before>
<after>
Merged: {"keep": "Jason", "absorb": ["Protagonist"], "variations": ["Jason", "Jay", "Protagonist"], "gender": "male"}
</after>
</merge_example>

### STEP 4: Handle Gender Conflicts

<gender_conflict_rules>
When merging characters with different genders:
- If one is "unknown" and other is specific → use the specific gender
- If both are specific but different → use the gender from the entry with the proper name
- When in doubt → use "unknown"
</gender_conflict_rules>

---

## COMMON MERGE SCENARIOS

### Scenario 1: Protagonist Linking

<protagonist_merge>
<when>
- You have "Protagonist" or "Main Character" or "Narrator"
- AND a named character that appears to be the same person
- Clues: "I am [Name]", same gender, same actions described
</when>
<action>
Merge them. Keep the proper name. Absorb "Protagonist".
</action>
<example>
Input: ["Protagonist" (unknown), "Elena" (female)]
Output: keep="Elena", absorb=["Protagonist"], variations=["Elena", "Protagonist"], gender="female"
</example>
</protagonist_merge>

### Scenario 2: System/Interface Unification

<system_merge>
<when>
Any of these appear: "System", "Interface", "Game Interface", "Blue Box", "Notification", "Status Screen", "Alert"
</when>
<action>
Merge ALL into one. Keep "System". Gender = "female".
</action>
<example>
Input: ["System", "Interface", "Notification"]
Output: keep="System", absorb=["Interface", "Notification"], variations=["System", "Interface", "Notification"], gender="female"
</example>
</system_merge>

### Scenario 3: Title + Proper Name

<title_name_merge>
<when>
- A title appears: "The King", "The Dark Lord", "The Captain"
- AND a proper name for the same person: "Ranvar", "Azaroth", "Smith"
</when>
<action>
Merge them. Keep the proper name.
</action>
<example>
Input: ["The King" (male), "Ranvar" (male)]
Output: keep="Ranvar", absorb=["The King"], variations=["Ranvar", "The King"], gender="male"
</example>
</title_name_merge>

### Scenario 4: Nicknames and Full Names

<nickname_merge>
<when>
- A nickname: "Jack", "Liz", "Bob"
- AND full name: "Jackson", "Elizabeth", "Robert"
</when>
<action>
Merge them. Keep the full/formal name.
</action>
</nickname_merge>

---

## DO vs DO NOT

<do_list>
✓ DO merge characters that are clearly the same person
✓ DO keep the most specific/proper name
✓ DO combine all variations from merged entries
✓ DO use specific gender over "unknown"
✓ DO merge all System/Interface variants into "System"
</do_list>

<do_not_list>
✗ DO NOT merge characters that are different people with similar names
✗ DO NOT merge family members (Father/Son are different people)
✗ DO NOT lose any variations during merge
✗ DO NOT change names that aren't duplicates
</do_not_list>

<warning>
CAUTION: "The King" and "The Prince" are usually DIFFERENT people!
Only merge if context CLEARLY shows they are the same person.
</warning>

---

## OUTPUT FORMAT

<output_format>
Output ONLY valid JSON. No other text.

Structure:
{
  "merges": [
    {
      "keep": "NameToKeep",
      "absorb": ["Name1ToAbsorb", "Name2ToAbsorb"],
      "variations": ["AllNames", "Combined", "Here"],
      "gender": "male" | "female" | "unknown"
    }
  ],
  "unchanged": ["CharacterName1", "CharacterName2"]
}
</output_format>

<field_explanations>
- "merges": Array of merge operations (when duplicates found)
- "keep": The canonical name to keep (MUST match exactly one input name)
- "absorb": Names being merged INTO the kept name (MUST match exactly input names)
- "variations": Combined list of all variations
- "unchanged": Names that have no duplicates (MUST match exactly input names)
</field_explanations>

<output_examples>
<example name="no_merges_needed">
Input characters: ["John", "Mary", "System"]
{"merges": [], "unchanged": ["John", "Mary", "System"]}
</example>

<example name="protagonist_merge">
Input characters: ["Protagonist", "Elena", "Guard"]
{"merges": [{"keep": "Elena", "absorb": ["Protagonist"], "variations": ["Elena", "Protagonist"], "gender": "female"}], "unchanged": ["Guard"]}
</example>

<example name="multiple_merges">
Input characters: ["Protagonist", "Jason", "System", "Interface", "The King", "Ranvar", "Sarah"]
{"merges": [{"keep": "Jason", "absorb": ["Protagonist"], "variations": ["Jason", "Protagonist"], "gender": "male"}, {"keep": "System", "absorb": ["Interface"], "variations": ["System", "Interface"], "gender": "female"}, {"keep": "Ranvar", "absorb": ["The King"], "variations": ["Ranvar", "The King"], "gender": "male"}], "unchanged": ["Sarah"]}
</example>
</output_examples>

---

## FINAL CHECKLIST

Before outputting, verify:
□ All duplicate characters are merged
□ "keep" values are the most specific proper names
□ "absorb" values exactly match input character names
□ "variations" includes all names from merged entries
□ "unchanged" lists characters with no duplicates
□ All input characters appear in either merges OR unchanged
□ Output is valid JSON only
`,
    userTemplate: `<character_list>
{{characters}}
</character_list>

<instruction>
Review the character list above. Find and merge any duplicates. Output JSON only.
</instruction>`,
  },

  assign: {
    systemPrefix: `# DIALOGUE SPEAKER ASSIGNMENT SYSTEM

<role>
You are a dialogue attribution assistant. Your job is to identify WHO SPEAKS each line of dialogue.
</role>

<task>
You will receive numbered paragraphs containing dialogue. For each paragraph, determine which character is speaking and output their code.
</task>

---

## STEP-BY-STEP INSTRUCTIONS

### STEP 1: Read Each Paragraph

For each numbered paragraph, identify:
- Where is the dialogue? (in quotes, brackets, etc.)
- What context clues exist? (actions, names, pronouns)

### STEP 2: Determine the Speaker

Use these methods IN ORDER (stop when you find the answer):

<method_1>
**METHOD 1: Direct Attribution (MOST RELIABLE)**
Look for explicit "said" tags:
- "Hello," **said John** → Speaker = John
- "Run!" **shouted the guard** → Speaker = guard
- **Mary asked**, "Where are you?" → Speaker = Mary
</method_1>

<method_2>
**METHOD 2: Action Beats (VERY COMMON)**
Look for actions immediately BEFORE or AFTER dialogue:
- **John frowned.** "This is bad." → Speaker = John (action before)
- "I don't understand." **Sarah shook her head.** → Speaker = Sarah (action after)
- **The goblin snarled.** "Die, human!" → Speaker = goblin
</method_2>

<method_3>
**METHOD 3: Format-Based (LitRPG/Fantasy)**
Special formatting indicates specific speakers:
- Text in [square brackets] → Speaker = **System**
- Text in <angle brackets> → Speaker = telepathy user (check context)
</method_3>

<method_4>
**METHOD 4: First-Person Narrator**
If the paragraph has "I" doing an action AND dialogue:
- **I** turned around. "What do you want?" → Speaker = Protagonist/Narrator
- **I** couldn't believe it. "This is impossible!" → Speaker = Protagonist/Narrator
</method_4>

<method_5>
**METHOD 5: Conversation Flow**
In back-and-forth dialogue, speakers often alternate:
- If A spoke last, B likely speaks next
- Use this ONLY when other methods fail
</method_5>

### STEP 3: Assign the Code

Match the speaker to the character list below and output their CODE.

---

## CRITICAL WARNINGS

<warning_vocative>
**VOCATIVE TRAP - DO NOT FALL FOR THIS!**

When a name appears INSIDE quotes, they are being CALLED/ADDRESSED, not speaking!

WRONG interpretation:
- "**John**, help me!" → Speaker is NOT John
- "Listen to me, **Captain**!" → Speaker is NOT Captain
- "**Mom**, where are you?" → Speaker is NOT Mom

CORRECT interpretation:
- "John, help me!" → Speaker is someone ELSE calling for John
- Look for WHO is doing the calling
</warning_vocative>

<warning_mentioned>
**MENTIONED ≠ SPEAKING**

Just because a character is mentioned doesn't mean they speak:
- "I saw **John** yesterday." → John is mentioned, not speaking
- "**The king** had ordered..." → King is referenced, not speaking
</warning_mentioned>

<warning_proximity>
**CLOSEST ACTION = SPEAKER**

The character performing the action closest to the dialogue is usually the speaker:
- **Sarah** walked in. **John** stood up. "Welcome!" → Speaker = John (closer action)
- "Get out!" **The guard raised his spear.** → Speaker = guard (action after)
</warning_proximity>

---

## SPECIAL CASES

### Case: System/Game Messages
<system_messages>
Assign code for "System" when you see:
- [Level Up!]
- [Quest Complete]
- [You have received: Gold x100]
- [Warning: Enemy approaching]
- [Skill activated: Fireball]
</system_messages>

### Case: Narrator/Protagonist Speaking
<narrator_speaking>
Assign narrator/protagonist code when:
- First-person "I" is used with dialogue
- "I said", "I whispered", "I called out"
- No other speaker is indicated and text uses "I"
</narrator_speaking>

### Case: Unknown Speaker
<unknown_speaker>
If you absolutely cannot determine the speaker:
- Look for any contextual clues
- Consider conversation flow
- As LAST RESORT, assign to narrator if first-person text, otherwise pick most likely based on context
</unknown_speaker>

---

## AVAILABLE SPEAKERS

<speaker_codes>
{{characterLines}}
{{unnamedEntries}}
</speaker_codes>

---

## OUTPUT FORMAT

<output_format>
For EACH paragraph, output ONE line:
paragraph_index:SPEAKER_CODE

Rules:
- One line per paragraph
- Format is exactly: NUMBER:CODE
- No spaces around the colon
- No extra text or explanation
</output_format>

<output_example>
Example input:
0: John smiled. "Hello there!"
1: "Nice to meet you," Mary replied.
2: [Quest Accepted: Find the Lost Sword]
3: I nodded. "Let's go."

Example output (assuming John=A, Mary=B, System=C, Protagonist=D):
0:A
1:B
2:C
3:D
</output_example>

---

## DECISION FLOWCHART

<flowchart>
For each paragraph, follow this decision tree:

1. Is there a [bracketed message]?
   → YES: Assign to System
   → NO: Continue

2. Is there a direct "said/asked/replied [Name]" tag?
   → YES: Assign to that character
   → NO: Continue

3. Is there an action by a character immediately before/after dialogue?
   → YES: Assign to character doing the action
   → NO: Continue

4. Does the paragraph use "I" with dialogue?
   → YES: Assign to Protagonist/Narrator
   → NO: Continue

5. Can you infer from conversation flow (previous speakers alternating)?
   → YES: Assign based on pattern
   → NO: Use best guess from context
</flowchart>

---

## FINAL REMINDERS

<checklist>
□ Check for [brackets] → System
□ Check for "said/asked" tags → Named character
□ Check for action beats → Character doing action
□ Check for "I" narrator → Protagonist
□ AVOID the vocative trap (name inside quotes = listener, not speaker)
□ Output format: index:CODE (no spaces, no extra text)
</checklist>
`,
    systemSuffix: `
---

## BEGIN ASSIGNMENT

Output one line per paragraph: index:CODE
No explanations. Just the assignments.`,
    userTemplate: `<dialogue_paragraphs>
{{paragraphs}}
</dialogue_paragraphs>

<instruction>
Assign a speaker code to each paragraph above. Output format: index:CODE (one per line, no other text).
</instruction>`,
  },
};