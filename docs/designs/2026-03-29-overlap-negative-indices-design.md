# Overlap with Negative Indices

**Date:** 2026-03-29
**Status:** Draft

## Problem

Blocks are processed independently in the Assign phase. Each block starts "blind" — the LLM has no idea what dialogue just happened. This hurts continuity at block boundaries, especially for multi-turn conversations that span across the split point.

## Solution

Pass the last 5 sentences of the previous block as read-only context, labeled with negative indices `[-5]` through `[-1]`. The LLM sees what just happened but is explicitly instructed not to assign speakers to these sentences.

## Design

### Constants

```typescript
const OVERLAP_SIZE = 5;
```

### Data Flow

```
For each block (blockIndex N):
  ├── If N > 0:
  │     overlap = blocks[N - 1].sentences.slice(-OVERLAP_SIZE)
  │     label as: [-5], [-4], [-3], [-2], [-1]
  │     (fewer than 5 if the previous block had < 5 sentences)
  ├── Else (block 0):
  │     overlap section is OMITTED entirely
  │
  └── Inject into prompt (only when N > 0):
        <previous_context_do_not_assign>
        [-5] Raw sentence text.
        [-4] Another sentence.
        ...
        [-1] Last sentence of previous block.
        </previous_context_do_not_assign>
```

### Constraints

- **Raw text only** — no speaker names or codes in the overlap sentences.
- **Pre-split data** — overlap sentences come from the `TextBlock` array, not from LLM responses. No sequential dependency. Parallel batch processing is unchanged.
- **Omit for block 0** — the `<previous_context_do_not_assign>` section is not injected at all for the first block. Empty tags can cause LLMs to hallucinate content.
- **No schema changes** — `AssignSchema` stays as-is. Post-processing only looks up indices `0..sentences.length-1`, so any accidental negative-index assignments are silently ignored.

### Prompt Changes

#### `src/config/prompts/assign.ts`

**Rules section** — add a rule:

> Paragraphs labeled with negative indices ([-5] through [-1]) inside `<previous_context_do_not_assign>` are from the previous section for context only. Do NOT assign speaker codes to them.

**User template** — add `{{previousContext}}` placeholder between the speaker codes and numbered paragraphs, and a recency-bias reminder at the bottom:

```
<speaker_codes>
{{characterLines}}
{{unnamedEntries}}
</speaker_codes>

{{previousContext}}

<numbered_paragraphs>
{{paragraphs}}
</numbered_paragraphs>

[Note: Only assign speaker codes to paragraphs [0] and above.]
Assign the correct speaker code to each paragraph that contains dialogue...
```

### Code Changes

#### `src/services/llm/PromptStrategy.ts` — `buildAssignPrompt()`

Add a `previousBlockSentences` parameter (or derive from a passed block index). When present (non-empty):

1. Label each sentence with negative indices: `[-overlap.length + i]` for `i` in `0..overlap.length-1`
2. Wrap in `<previous_context_do_not_assign>...</previous_context_do_not_assign>`
3. Inject into the `{{previousContext}}` placeholder

When no overlap (block 0), replace `{{previousContext}}` with an empty string.

#### `src/services/llm/LLMVoiceService.ts` — `assignSpeakers()`

When calling `processAssignBlock()` for block `N`, pass `blocks[N - 1]?.sentences.slice(-OVERLAP_SIZE)` as the overlap data. The batch processing loop already has access to the full `blocks[]` array.

#### `src/services/llm/LLMVoiceService.ts` — `processAssignBlock()`

Forward the overlap sentences to `buildAssignPrompt()`.

### Files Modified

| File | Change |
|---|---|
| `src/config/prompts/assign.ts` | Add rule about negative indices, add `{{previousContext}}` placeholder to template, add recency-bias note at bottom |
| `src/services/llm/PromptStrategy.ts` | Accept overlap sentences in `buildAssignPrompt()`, compute negative indices, inject wrapped text |
| `src/services/llm/LLMVoiceService.ts` | Pass previous block's last 5 sentences through to `processAssignBlock()` and into the prompt builder |

### Not Modified

- `AssignSchema` / response parsing
- `TextBlockSplitter`
- Parallel batch processing model
- Voting / QA logic
- `TextBlock` type
