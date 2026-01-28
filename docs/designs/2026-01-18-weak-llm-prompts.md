# Weak LLM Prompt Optimizations

**Date:** 2025-01-18
**Status:** Design Complete
**Target:** Kimi K2 and other weak/cheaper LLM models

## Problem

Current LLM prompts work adequately with strong models (GPT-4, Claude) but fail with cheaper models like Kimi K2. Weak models struggle with:
- Complex reasoning chains
- Distinguishing sound effects from LitRPG System messages
- Transitive properties in merge operations
- Grammar nuances in speaker attribution

## Solution

Apply rigid, repetitive, and explicit prompt optimizations targeted at weak model limitations.

## Changes

### 1. extract.ts

**Add Candidate Prosecution Step:**
- Forces model to "prove" each candidate speaks before adding to JSON
- Yes/No questions: "Did they speak?", "Is name only inside quotes?"

**Add Sound Effect Distinction:**
```
[Sigh], [Bang!], [Silence] → Narrator (Do NOT extract)
[Level Up], [Quest], [Status] → System (DO extract)
```

**Reposition Vocative Rule:**
- Move to end with "REMEMBER:" prefix for recency bias

### 2. merge.ts

**Add Anchor Identification:**
- Find unique full names first (anchors)
- Attach variations to anchors
- Prevents chain-merge errors

**Add Safety Threshold:**
```
90% sure → Merge
50% sure → Separate
Better to have two "Johns" than merge different people
```

**Mechanical Scratchpad Format:**
```
Check: "John" → Matches Anchor "John Smith"? [Yes]
Check: "The Guard" → Matches Anchor "Guard Captain"? [No]
```

### 3. assign.ts

**Simplify Role Description:**
- Change "Literary Analyst" to "Attribution Machine"
- Remove fluff text

**Add Grammar Check:**
```
John looked at Mary. "Hello." → Subject is John → Speaker is John
Mary was hit by John. "Ouch!" → Subject is Mary (passive) → Speaker is Mary
```

**Move Negative Constraints:**
- Move "NO Markdown", "NO Explanations" to very end
- Leverage recency bias

**Enhance Vocative Trap:**
```
"Hello, John" → Comma before name = Vocative (John is Listener)
"John, look!" → Comma after name = Vocative (John is Listener)
```

## Testing Strategy

1. Mock tests with known edge cases
2. Real API tests with Kimi K2
3. Compare output quality vs. current prompts

## Files Modified

- `src/config/prompts/extract.ts`
- `src/config/prompts/merge.ts`
- `src/config/prompts/assign.ts`
