# Chain of Draft: Replace CoT with CoD in LLM Prompts

**Date:** 2026-04-11
**Status:** Draft
**Scope:** Prompt engineering only — no code changes

## Problem

All four LLM pipeline stages (extract, merge, assign, QA) use Chain-of-Thought prompts that encourage verbose reasoning inside the JSON `"reasoning"` field. The prompts say "step-by-step work" and "Follow these steps IN ORDER: Step 1, Step 2...", which produces narrative prose. Example from assign:

```
"0 has dialogue 'Observe' with explicit tag 'Professor Viridian said' -- the long narration after it describes his actions but the speaker is Viridian. 1 is narration. 2 has dialogue with explicit tag 'the professor said' -- professor = Viridian. 3 is narration describing Mirian's perspective but no dialogue."
```

~50 words. The CoD equivalent:

```
"0: Viridian said tag→A. 1: narr. 2: professor=Viridian→A. 3: narr."
```

~10 words. This compounds across every LLM call in the pipeline (assign runs per chunk, merge runs 5-way voting).

## Solution

Replace CoT framing with CoD framing in all prompt rules and examples. The change is purely textual — no code changes, no new enums, no parser modifications.

### Changes Overview

| File | What Changes |
|------|-------------|
| `shared/rules.ts` | EXECUTION_TRIGGER: add "max 5 words per step" directive |
| `extract/rules.ts` | Remove numbered step instructions; add CoD shorthand guidance |
| `merge/rules.ts` | Same |
| `assign/rules.ts` | Same |
| `qa/rules.ts` | Same |
| `extract/examples/en.ts` | Rewrite all 4 example reasoning fields in CoD style |
| `merge/examples/en.ts` | Rewrite all 4 example reasoning fields in CoD style |
| `assign/examples/en.ts` | Rewrite all 5 example reasoning fields in CoD style |
| `qa/examples/en.ts` | Rewrite all 3 example reasoning fields in CoD style |

No other files are touched. The JSON schema, builder logic, parsing, API client, and stores remain identical.

---

## Detailed Changes

### 1. `src/config/prompts/shared/rules.ts` — EXECUTION_TRIGGER

**Current:**
```
OUTPUT FORMAT: Return ONLY a single, valid JSON object. Write all reasoning inside the JSON "reasoning" field. No tool calls, no markdown code blocks, no thinking tags.
```

**Proposed:**
```
OUTPUT FORMAT: Return ONLY a single, valid JSON object. Write all reasoning inside the JSON "reasoning" field as concise drafts (max 5 words per step, shorthand notation). No tool calls, no markdown code blocks, no thinking tags.
```

### 2. Per-Stage Rules Changes

Each stage's `rules.ts` has the same pattern at the bottom:

```
Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
CRITICAL: Keep reasoning extremely concise. [stage-specific constraint]
Follow these steps IN ORDER:

Step 1: ...
Step 2: ...
...
Step N: ...
```

**Proposed pattern** (replaces the above block in all stages):

```
Write your reasoning inside the JSON "reasoning" field as terse drafts (max 5 words per step). Use shorthand: paragraph numbers, speaker codes, arrow notation. Skip obvious cases. Only note ambiguous or corrected items.
```

The numbered steps (Step 1 through Step N) are **removed** entirely. The rules above them already describe the methodology in detail. The numbered steps were a CoT artifact that encouraged the model to narrate each step as prose.

#### Stage-Specific Shorthand Hints

Each stage gets a tailored shorthand hint replacing the removed numbered steps:

**Extract:**
```
Shorthand: "N: speaker(code)" for found characters, "voc" for vocatives to skip.
```

**Merge:**
```
Shorthand: "X+Y→X" for merges, "uniq" for no-match characters, "sys" for system entities.
```

**Assign:**
```
Shorthand: "N: code" for assignments, "narr" for narration-only, "voc" for vocative traps.
```

**QA:**
```
Shorthand: "N: old→new (reason)" for corrections, "ok" for correct assignments, "rm N" for removed.
```

### 3. Example Rewrites

All few-shot examples are rewritten to use compressed draft-style reasoning. The input/output JSON structure stays identical — only the `"reasoning"` string changes.

#### Extract Examples (4 examples)

| # | Label | Current Reasoning | CoD Reasoning |
|---|-------|-------------------|---------------|
| 1 | Simple | `"John speaks first with an action beat. Mary replies with 'she replied.' Mary's name in the first quote is vocative -- she is the listener, not speaker."` | `"John(beat). Mary('she replied'). Mary voc-listener."` |
| 2 | System+1st | `"The guard shouts a warning. The narrator (I) replies. The Captain is spoken to, but doesn't speak. [Level Up!] is a system message."` | `"Guard(shout). Protag('I'). Captain voc-only. System(bracket)." ` |
| 3 | VocativeTrap | `"Mary speaks in quotes 1 and 3 (explicit tags). John speaks in quotes 2 and 4 (tag + action beat). 'John' inside Mary's first quote is vocative -- he is the listener. Marcus is only mentioned as vocative in quote 3 and never speaks -- do NOT extract."` | `"Mary(tag q1,q3). John(tag q2, beat q4). John voc-q1. Marcus voc-only, skip."` |
| 4 | Gender+Var | `"The wizard speaks twice (action beat + 'the wizard said'). Galdor speaks once ('cried Galdor'). System sends a bracket message. 'He' in Galdor's quote refers to the wizard, not a vocative. Wizard uses 'his' -> male. System -> female."` | `"Wizard(beat+tag, 2x, his→M). Galdor(cried). System(bracket→F). 'He'=wizard, not voc."` |

#### Merge Examples (4 examples)

| # | Label | Current Reasoning | CoD Reasoning |
|---|-------|-------------------|---------------|
| 1 | SharedVar | `"0 and 1 are game systems. 2 and 3 share the variation 'Alex' and are male. 4 is unique."` | `"0+1: sys. 3+2: shared 'Alex', both M. 4: uniq."` |
| 2 | SysLinking | `"Blue Box, Notification, System, and Quest are all game system entities. Merge them with System as the best name."` | `"0+1+3+4: all sys entities. 3=best name→[3,0,1,4]."` |
| 3 | NoMerges | `"No characters share names or roles."` | `"No shared names/roles."` |
| 4 | ProtagOrdering | `"Protagonist and Marcus Chen are likely the same person (male, main character). Marcus Chen is the better name. Elena and Lyra are different people."` | `"0+1: protag=Marcus(M, MC). 1=better name→[1,0]. Elena≠Lyra."` |

#### Assign Examples (5 examples)

| # | Label | Current Reasoning | CoD Reasoning |
|---|-------|-------------------|---------------|
| 1 | Simple | `"0 is narration. 1 has John speaking. 2 has Mary speaking. 3 is a System message."` | `"0: narr. 1: John→A. 2: Mary→B. 3: sys→C."` |
| 2 | VocativeTrap | `"0 is the guard. 1 is the protagonist ('I'). 2 is the guard speaking to Captain (vocative -- Captain is listener). 3 is the guard continuing."` | `"0: guard→B. 1: 'I'→A. 2: guard→B, Captain voc. 3: guard cont→B."` |
| 3 | FirstPersonCtx | `"1 is Protagonist ('I shook my head'). 2 is Marcus (action beat). 3 is Elena (action beat). 4 is Protagonist ('I said')."` | `"1: 'I'→A. 2: Marcus beat→B. 3: Elena beat→C. 4: 'I said'→A."` |
| 4 | SystemAndMixed | `"1 is a system message. 2 is Kira (explicit tag). 3 is narration. 4 is a system message. 5 is Kira (action beat, 'She' refers to Kira)."` | `"1: sys→B. 2: Kira tag→A. 3: narr. 4: sys→B. 5: 'She'=Kira beat→A."` |
| 5 | LongNarration | ~50 words (see Problem section above) | `"0: Viridian tag→A. 1: narr. 2: professor=Viridian tag→A. 3: narr."` |

#### QA Examples (3 examples)

| # | Label | Current Reasoning | CoD Reasoning |
|---|-------|-------------------|---------------|
| 1 | VocativeTrap | `"Found vocative trap in [2]: 'John' inside quotes is the listener, not speaker. Reassigned to Guard (B)."` | `"2: voc trap, John=listener→B (was A)."` |
| 2 | MissedActionBeat | `"Fixed missed action beat: [0] has 'Mary smiled' action beat, but 'Hello there' is spoken by someone else before Mary smiled. Context suggests Protagonist spoke first."` | `"0: beat 'Mary smiled' after quote→not Mary. Protag spoke→B (was A)."` |
| 3 | RemovedNarr+Missing | `"Removed misassigned narration from [0] (door description has no speaker). [3] is also narration, correctly omitted."` | `"0: door narr, rm (was A). 1: sys→B ok. 2: Kira→A ok."` |

---

## What Stays the Same

- JSON output schema (Zod schemas, `safeParseJSON`, structured output pipeline)
- Builder logic (`buildMessages`, `assembleSystemPrompt`)
- API client (`LLMApiClient`, `callStructured`, `enable_thinking`/`reasoning_effort`)
- `ReasoningLevel` type and store configuration
- Chinese system preamble (`SYSTEM_PREAMBLE_CN`)
- Voting/consensus logic in merge
- QA draft-correction flow in assign
- All non-reasoning rules in each stage (vocative trap explanation, action beat definitions, etc.)

## Risks

| Risk | Mitigation |
|------|-----------|
| Accuracy regression on edge cases | CoD paper shows matching or better accuracy on GPT-4o and Claude 3.5 Sonnet. The paper warns about zero-shot degradation, but we use few-shot examples. If accuracy drops, revert is trivial (prompt text only). |
| Model ignores 5-word constraint | The paper notes this is a soft limit — models often exceed it but still produce much shorter output than CoT. The few-shot examples are the primary enforcement mechanism. |
| Shorthand ambiguity | The examples define the notation implicitly. If a model produces unclear shorthand, the structured JSON data (assignments, characters, merges) is what matters — the reasoning field is diagnostic. |

## Implementation Order

1. `shared/rules.ts` — EXECUTION_TRIGGER
2. `extract/rules.ts` — remove numbered steps, add shorthand hint
3. `extract/examples/en.ts` — rewrite 4 examples
4. `merge/rules.ts` — remove numbered steps, add shorthand hint
5. `merge/examples/en.ts` — rewrite 4 examples
6. `assign/rules.ts` — remove numbered steps, add shorthand hint
7. `assign/examples/en.ts` — rewrite 5 examples
8. `qa/rules.ts` — remove numbered steps, add shorthand hint
9. `qa/examples/en.ts` — rewrite 3 examples

## Testing

- Run `npm run check` (format, lint, typecheck, test) — should pass since no code changes
- Manual test: convert a chapter with a known set of characters and verify extraction/assignment accuracy matches current behavior
