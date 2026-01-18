# Weak LLM Prompt Optimizations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Optimize LLM prompts (extract, merge, assign) for weak models like Kimi K2 by adding explicit reasoning steps, mechanical scratchpad formats, and recency-bias positioning.

**Architecture:** Three prompt files in `src/config/prompts/` are modified independently. Each change is a string replacement/addition. No code logic changes, only prompt content.

**Tech Stack:** TypeScript, existing LLM prompt infrastructure

---

## Task 1: Add Sound Effects Distinction to extract.ts System Prompt

**Files:**
- Modify: `src/config/prompts/extract.ts`

**Step 1: Locate METHOD 3: LITRPG FORMAT section**

Find the table in system prompt around line 47:
```typescript
**METHOD 3: LITRPG FORMAT**
| Format | Speaker |
|--------|---------|
```

**Step 2: Add sound effect distinction rule after the table**

Add this block immediately after the LitRPG table (before `### STEP 4`):

```typescript
<critical_rule>
**CRITICAL: SYSTEM vs. SOUNDS**

Square brackets can be System messages OR sound effects. Distinguish them:

| Content | Speaker | Action |
|---------|---------|--------|
| [Level Up], [Quest], [Status], [Blue Box] | **System** | EXTRACT as "System" |
| [Sigh], [Bang!], [Silence], [Phone rings] | **Narrator** | DO NOT create character |

Sound effects describe ambient noise. System messages are game UI.

Examples:
- "[Level Up!]" → Extract "System"
- "[Sigh]" → DO NOT extract (narrator sound effect)
- "[Quest Complete: Kill 5 Goblins]" → Extract "System"
- "[Thunder crashes]" → DO NOT extract (sound effect)
</critical_rule>
```

**Step 3: Verify formatting**

Ensure the file compiles:
```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/extract.ts
git commit -m "feat(extract): add sound effects vs system distinction"
```

---

## Task 2: Add Candidate Prosecution to extract.ts User Template

**Files:**
- Modify: `src/config/prompts/extract.ts`

**Step 1: Locate userTemplate section**

Find `userTemplate:` near the end of the file (after the `system` property).

**Step 2: Add Candidate Prosecution step**

Replace the entire `userTemplate` with this version that enforces a reasoning step:

```typescript
  userTemplate: `<task_description>
Extract characters who speak in the provided text.
To ensure accuracy, you MUST perform a "Candidate Prosecution" step before outputting JSON.
</task_description>

<text>
{{text}}
</text>

<instruction>
STEP 1: CANDIDATE PROSECUTION (Mental Scratchpad)

Scan the text. For EVERY potential name found, ask:

1. Did they speak out loud or think?
   - If NO → Ignore (mentioned only, not speaking)
   - If YES → Continue to step 2

2. Is the name ONLY inside quotes?
   - "Hello, John" → John is inside quotes → Listener, ignore
   - If YES → Ignore (vocative)
   - If NO → Continue to step 3

3. Is it a bracketed text?
   - [Level Up] → System
   - [Sigh] → Sound effect (Narrator, do not extract)
   - <Telepathy> → Check context for speaker

STEP 2: GENERATE JSON

Extract ONLY those with "YES" in Step 1.

Output valid JSON only.
</instruction>`,
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/extract.ts
git commit -m "feat(extract): add candidate prosecution step"
```

---

## Task 3: Move Vocative Rule to End of extract.ts (Recency Bias)

**Files:**
- Modify: `src/config/prompts/extract.ts`

**Step 1: Locate the FINAL CHECKLIST section**

Find `## FINAL CHECKLIST` near the end of the system prompt.

**Step 2: Add REMEMBER block after FINAL CHECKLIST**

Add this block immediately after the checklist (before the closing ```):
```typescript
<remember>
REMEMBER:
- [Sigh] = Sound effect → DO NOT extract
- [Level Up] = System → DO extract
- "Hello, John" → John is listener, NOT speaker
- Names inside quotes = vocative (listener)
</remember>
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/extract.ts
git commit -m "feat(extract): move critical rules to end for recency bias"
```

---

## Task 4: Add Anchor Identification to merge.ts User Template

**Files:**
- Modify: `src/config/prompts/merge.ts`

**Step 1: Locate userTemplate**

Find `userTemplate:` in mergePrompt object.

**Step 2: Replace userTemplate with mechanical format**

Replace the entire `userTemplate` with:

```typescript
  userTemplate: `<character_list>
{{characters}}
</character_list>

<instruction>
Analyze the list for duplicates.

<scratchpad>
STEP 1: IDENTIFY ANCHORS
Anchors are unique, full names (e.g., "John Smith", "Elizabeth Queen").
List all anchors:
- Anchor 1: [name]
- Anchor 2: [name]
...

STEP 2: PAIRWISE CHECK
For every other entry, check if it belongs to an Anchor:
- Check: "John" → Matches Anchor "John Smith"? [Yes/No]
- Check: "The Guard" → Matches Anchor "Guard Captain"? [Yes/No]
- Check: "System" → Matches Anchor "Game Interface"? [Yes/No]

STEP 3: LIST MERGE GROUPS
Based on checks above, list groups:
- Group 1: [keep_index, absorb_index1, absorb_index2, ...]
...
</scratchpad>

<safety_rule>
**WHEN IN DOUBT, SEPARATE.**

If you are 90% sure they are the same → MERGE.
If you are 50% sure → DO NOT MERGE.

It is better to have two "Johns" than to accidentally merge "John Smith" and "John Doe".
</safety_rule>

Output valid JSON only.

Remember:
- Variations overlap = likely same person
- Keep most specific proper name
- System/Interface → merge into "System"
- Different genders = different people (unless one unknown)
</instruction>`,
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/merge.ts
git commit -m "feat(merge): add anchor identification and safety thresholds"
```

---

## Task 5: Simplify Role in assign.ts

**Files:**
- Modify: `src/config/prompts/assign.ts`

**Step 1: Locate the <role> tag**

Find `<role>` near the beginning of `systemPrefix`.

**Step 2: Replace with simplified role**

Replace the entire role block with:
```typescript
<role>
You are an attribution machine. You determine who speaks each line of dialogue.
</role>
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/assign.ts
git commit -m "feat(assign): simplify role description"
```

---

## Task 6: Add Grammar Check to assign.ts Action Beats

**Files:**
- Modify: `src/config/prompts/assign.ts`

**Step 1: Locate PRIORITY 3: ACTION BEATS**

Find the section `<action_beats>` in systemPrefix.

**Step 2: Add Grammar Check after ACTIVE vs PASSIVE rule**

Add this block after the "ACTIVE vs PASSIVE" examples (still within `<action_beats>`):
```typescript
<grammar_check>
**GRAMMAR CHECK (Subject vs Object)**

Look for the SUBJECT of the sentence closest to the quote:

- "John looked at Mary. 'Hello.'" → Subject is John → Speaker is John
- "Mary was hit by John. 'Ouch!'" → Subject is Mary (passive voice) → Speaker is Mary
- "John hit Mary. 'Ouch!'" → Subject is John. But 'Ouch' is a reaction → Context implies Mary

**Rule:** If unclear, prioritize the character performing the ACTIVE verb.
</grammar_check>
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/assign.ts
git commit -m "feat(assign): add grammar check for subject vs object"
```

---

## Task 7: Move Negative Constraints to End of assign.ts

**Files:**
- Modify: `src/config/prompts/assign.ts`

**Step 1: Locate systemSuffix**

Find `systemSuffix:` in assignPrompt object.

**Step 2: Replace with reordered version (negative constraints last)**

Replace the entire `systemSuffix` with:
```typescript
  systemSuffix: `

---

## OUTPUT FORMAT REMINDERS

<speaker_list>
{{characterLines}}
{{unnamedEntries}}
</speaker_list>

Format: index:CODE (one per line, no spaces, no extra text)

Valid:
0:A
1:B
2:A

Invalid:
0: A (space)
0:A - John speaks (explanation)
\`\`\`json (markdown)

---

## BEGIN ASSIGNMENT

Analyze the paragraphs. Apply Attribution Methods in priority order.
Output index:CODE pairs, one line per paragraph.

REMEMBER - CRITICAL:
- [Brackets] → System
- Speech tags "said X" → Named character
- Action beats → Acting character (closest to dialogue)
- "I" narrator → Protagonist
- Names inside quotes = vocative (listener, NOT speaker)

NO Markdown
NO Explanations
JSON ONLY (index:CODE format)`,
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/assign.ts
git commit -m "feat(assign): move negative constraints to end for recency bias"
```

---

## Task 8: Enhance Vocative Trap in assign.ts

**Files:**
- Modify: `src/config/prompts/assign.ts`

**Step 1: Locate <vocative_trap> section**

Find the vocative trap section in systemPrefix (after PRIORITY 6).

**Step 2: Add comma position rules**

Add this block inside `<vocative_trap>`, after the existing examples:
```typescript
<comma_rule>
**THE "COMMA" RULE:**

If a name appears inside quotes:
- "Hello, John" → Comma BEFORE name = Vocative (John is Listener)
- "John, look!" → Comma AFTER name = Vocative (John is Listener)
- "John!" → Name alone with punctuation = Vocative (John is Listener)

Speaker is the OTHER person in the scene.
</comma_rule>
```

**Step 3: Verify formatting**

```bash
npm run type-check
```

**Step 4: Commit**

```bash
git add src/config/prompts/assign.ts
git commit -m "feat(assign): enhance vocative trap with comma rules"
```

---

## Task 9: Final Verification

**Files:**
- All modified files

**Step 1: Run type check**

```bash
npm run type-check
```
Expected: No errors

**Step 2: Run mock tests**

```bash
npm run test
```
Expected: All existing tests pass

**Step 3: Build verification**

```bash
npm run dev
```
Expected: Dev server starts successfully

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete weak LLM prompt optimizations

- extract: Added candidate prosecution step
- extract: Added sound effects vs system distinction
- extract: Moved critical rules to end (recency bias)
- merge: Added anchor identification
- merge: Added safety thresholds (90%/50%)
- assign: Simplified role description
- assign: Added grammar check for subject/object
- assign: Moved negative constraints to end
- assign: Enhanced vocative trap with comma rules

See docs/plans/2025-01-18-weak-llm-prompts-design.md for design."
```

---

## Summary

All tasks are independent string replacements. Each task commits after verification.
Total estimated time: 30-45 minutes.
