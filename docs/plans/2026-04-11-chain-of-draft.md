# Chain of Draft (CoD) Prompt Replacement — Implementation Plan

**Goal:** Replace verbose Chain-of-Thought reasoning in all LLM prompt rules and examples with concise Chain-of-Draft shorthand, reducing token usage while maintaining accuracy.
**Testing Conventions:** Vitest-based tests. Standard unit tests (`npm test`) run fast with mocked externals. Real LLM tests (`npm run test:real`) make actual API calls and validate character extraction/assignment accuracy. Since this is prompt-only changes, `npm run check` (format, lint, typecheck, test) should pass throughout.

---

### Task 1: Update EXECUTION_TRIGGER in shared rules

**Objective:** Add the CoD "max 5 words per step" directive to the shared EXECUTION_TRIGGER constant that is included in every LLM prompt.

**Files to modify:**
- Modify: `src/config/prompts/shared/rules.ts` (Purpose: Update `EXECUTION_TRIGGER` constant to include CoD directive)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand what Chain of Draft is and why it works. Read the full content of `src/config/prompts/shared/rules.ts` to see the current `EXECUTION_TRIGGER` constant.
2. **Modify:** In the `EXECUTION_TRIGGER` constant, change this line:
   - From: `Write all reasoning inside the JSON "reasoning" field.`
   - To: `Write all reasoning inside the JSON "reasoning" field as concise drafts (max 5 words per step, shorthand notation).`
3. **Verify:** Run `npm run check` — should pass (text change only, no code logic affected).
4. **Commit:** Commit with message: `feat(prompts): add CoD directive to EXECUTION_TRIGGER`

---

### Task 2: Replace CoT reasoning block in extract rules

**Objective:** Remove the numbered step-by-step instructions from extract rules and replace with CoD terse-draft guidance plus stage-specific shorthand hint.

**Depends on:** Task 1

**Files to modify:**
- Modify: `src/config/prompts/extract/rules.ts` (Purpose: Replace CoT block in `EXTRACT_RULES` with CoD pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/extract/rules.ts` to see the current `EXTRACT_RULES` constant.
2. **Modify:** At the bottom of the `EXTRACT_RULES` template string, find the block that contains:
   - "Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects."
   - "CRITICAL: Keep reasoning extremely concise. ..." (extract-specific constraint)
   - The numbered steps ("Step 1:", "Step 2:", etc.)

   Replace that entire block with:
   ```
   Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
   Shorthand: "N: speaker(code)" for found characters, "voc" for vocatives to skip.
   ```
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): replace CoT with CoD in extract rules`

---

### Task 3: Rewrite extract examples to CoD style

**Objective:** Rewrite all 4 few-shot example `"reasoning"` fields in extract examples from verbose prose to concise CoD shorthand.

**Depends on:** Task 2

**Files to modify:**
- Modify: `src/config/prompts/extract/examples/en.ts` (Purpose: Rewrite reasoning strings in `extractExamplesEN` array)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/extract/examples/en.ts` to see all 4 examples and their current reasoning strings.
2. **Modify:** Replace the `"reasoning"` value in each of the 4 examples with the CoD version. The design doc at `docs/designs/2026-04-11-chain-of-draft.md` contains the exact replacement text in the "Extract Examples (4 examples)" table. Use only those values. The JSON structure (keys, other field values) must remain unchanged — only the `"reasoning"` string changes.
   - Example 1 (Simple): Replace with `"John(beat). Mary('she replied'). Mary voc-listener."`
   - Example 2 (System+1st): Replace with `"Guard(shout). Protag('I'). Captain voc-only. System(bracket)."`
   - Example 3 (VocativeTrap): Replace with `"Mary(tag q1,q3). John(tag q2, beat q4). John voc-q1. Marcus voc-only, skip."`
   - Example 4 (Gender+Var): Replace with `"Wizard(beat+tag, 2x, his→M). Galdor(cried). System(bracket→F). 'He'=wizard, not voc."`
3. **Verify:** Run `npm run check` — should pass (string values only, no structural changes).
4. **Commit:** Commit with message: `feat(prompts): rewrite extract examples to CoD style`

---

### Task 4: Replace CoT reasoning block in merge rules

**Objective:** Remove the numbered step-by-step instructions from merge rules and replace with CoD terse-draft guidance plus merge-specific shorthand hint.

**Depends on:** Task 1

**Files to modify:**
- Modify: `src/config/prompts/merge/rules.ts` (Purpose: Replace CoT block in `MERGE_RULES` with CoD pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/merge/rules.ts` to see the current `MERGE_RULES` constant.
2. **Modify:** At the bottom of the `MERGE_RULES` template string, find the block that contains:
   - "Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting..."
   - "CRITICAL: Keep reasoning extremely concise. ..." (merge-specific constraint)
   - The numbered steps ("Step 1:", "Step 2:", etc.)

   Replace that entire block with:
   ```
   Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
   Shorthand: "X+Y→X" for merges, "uniq" for no-match characters, "sys" for system entities.
   ```
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): replace CoT with CoD in merge rules`

---

### Task 5: Rewrite merge examples to CoD style

**Objective:** Rewrite all 4 few-shot example `"reasoning"` fields in merge examples from verbose prose to concise CoD shorthand.

**Depends on:** Task 4

**Files to modify:**
- Modify: `src/config/prompts/merge/examples/en.ts` (Purpose: Rewrite reasoning strings in `mergeExamplesEN` array)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/merge/examples/en.ts` to see all 4 examples and their current reasoning strings.
2. **Modify:** Replace the `"reasoning"` value in each of the 4 examples with the CoD version. The design doc at `docs/designs/2026-04-11-chain-of-draft.md` contains the exact replacement text in the "Merge Examples (4 examples)" table. Use only those values. The JSON structure must remain unchanged — only the `"reasoning"` string changes.
   - Example 1 (SharedVar): Replace with `"0+1: sys. 3+2: shared 'Alex', both M. 4: uniq."`
   - Example 2 (SysLinking): Replace with `"0+1+3+4: all sys entities. 3=best name→[3,0,1,4]."`
   - Example 3 (NoMerges): Replace with `"No shared names/roles."`
   - Example 4 (ProtagOrdering): Replace with `"0+1: protag=Marcus(M, MC). 1=better name→[1,0]. Elena≠Lyra."`
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): rewrite merge examples to CoD style`

---

### Task 6: Replace CoT reasoning block in assign rules

**Objective:** Remove the numbered step-by-step instructions from assign rules and replace with CoD terse-draft guidance plus assign-specific shorthand hint.

**Depends on:** Task 1

**Files to modify:**
- Modify: `src/config/prompts/assign/rules.ts` (Purpose: Replace CoT block in `ASSIGN_RULES` with CoD pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/assign/rules.ts` to see the current `ASSIGN_RULES` constant.
2. **Modify:** At the bottom of the `ASSIGN_RULES` template string, find the block that contains:
   - "Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting..."
   - "CRITICAL: Keep reasoning extremely concise. ..." (assign-specific constraint)
   - The numbered steps ("Step 1:", "Step 2:", etc.)

   Replace that entire block with:
   ```
   Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
   Shorthand: "N: code" for assignments, "narr" for narration-only, "voc" for vocative traps.
   ```
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): replace CoT with CoD in assign rules`

---

### Task 7: Rewrite assign examples to CoD style

**Objective:** Rewrite all 5 few-shot example `"reasoning"` fields in assign examples from verbose prose to concise CoD shorthand.

**Depends on:** Task 6

**Files to modify:**
- Modify: `src/config/prompts/assign/examples/en.ts` (Purpose: Rewrite reasoning strings in `assignExamplesEN` array)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/assign/examples/en.ts` to see all 5 examples and their current reasoning strings.
2. **Modify:** Replace the `"reasoning"` value in each of the 5 examples with the CoD version. The design doc at `docs/designs/2026-04-11-chain-of-draft.md` contains the exact replacement text in the "Assign Examples (5 examples)" table. Use only those values. The JSON structure must remain unchanged — only the `"reasoning"` string changes.
   - Example 1 (Simple): Replace with `"0: narr. 1: John→A. 2: Mary→B. 3: sys→C."`
   - Example 2 (VocativeTrap): Replace with `"0: guard→B. 1: 'I'→A. 2: guard→B, Captain voc. 3: guard cont→B."`
   - Example 3 (FirstPersonCtx): Replace with `"1: 'I'→A. 2: Marcus beat→B. 3: Elena beat→C. 4: 'I said'→A."`
   - Example 4 (SystemAndMixed): Replace with `"1: sys→B. 2: Kira tag→A. 3: narr. 4: sys→B. 5: 'She'=Kira beat→A."`
   - Example 5 (LongNarration): Replace with `"0: Viridian tag→A. 1: narr. 2: professor=Viridian tag→A. 3: narr."`
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): rewrite assign examples to CoD style`

---

### Task 8: Replace CoT reasoning block in QA rules

**Objective:** Remove the numbered step-by-step instructions from QA rules and replace with CoD terse-draft guidance plus QA-specific shorthand hint.

**Depends on:** Task 1

**Files to modify:**
- Modify: `src/config/prompts/qa/rules.ts` (Purpose: Replace CoT block in `QA_RULES` with CoD pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/qa/rules.ts` to see the current `QA_RULES` constant.
2. **Modify:** At the bottom of the `QA_RULES` template string, find the block that contains:
   - "Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting..."
   - "CRITICAL: Keep reasoning extremely concise. ..." (QA-specific constraint)
   - The numbered steps ("Step 1:", "Step 2:", etc.)

   Replace that entire block with:
   ```
   Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
   Shorthand: "N: old→new (reason)" for corrections, "ok" for correct assignments, "rm N" for removed.
   ```
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): replace CoT with CoD in QA rules`

---

### Task 9: Rewrite QA examples to CoD style

**Objective:** Rewrite all 3 few-shot example `"reasoning"` fields in QA examples from verbose prose to concise CoD shorthand.

**Depends on:** Task 8

**Files to modify:**
- Modify: `src/config/prompts/qa/examples/en.ts` (Purpose: Rewrite reasoning strings in `qaExamplesEN` array)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `docs/Chain_of_Draft_Thinking_Faster_by_Writing_Less.md` to understand Chain of Draft. Read the full content of `src/config/prompts/qa/examples/en.ts` to see all 3 examples and their current reasoning strings.
2. **Modify:** Replace the `"reasoning"` value in each of the 3 examples with the CoD version. The design doc at `docs/designs/2026-04-11-chain-of-draft.md` contains the exact replacement text in the "QA Examples (3 examples)" table. Use only those values. The JSON structure must remain unchanged — only the `"reasoning"` string changes.
   - Example 1 (VocativeTrapCorrection): Replace with `"2: voc trap, John=listener→B (was A)."`
   - Example 2 (MissedActionBeat): Replace with `"0: beat 'Mary smiled' after quote→not Mary. Protag spoke→B (was A)."`
   - Example 3 (RemovedNarr+Missing): Replace with `"0: door narr, rm (was A). 1: sys→B ok. 2: Kira→A ok."`
3. **Verify:** Run `npm run check` — should pass.
4. **Commit:** Commit with message: `feat(prompts): rewrite QA examples to CoD style`
