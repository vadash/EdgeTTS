# Semantic Chunking (Scene Breaks)

**Date:** 2026-03-29
**Scope:** `src/services/TextBlockSplitter.ts`
**Affected types:** None (internal behavior change only)

## Problem

`TextBlockSplitter.splitIntoBlocks` packs sentences into blocks purely by token count. Block boundaries can land mid-dialogue, mid-scene, or mid-conversation. The LLM loses context at the seam, producing worse speaker assignments — especially in multi-character LitRPG/web novels.

## Solution

Once a block exceeds 85% of `maxTokens`, look for natural scene break candidates (ranked by priority) and cut early at the best available break point. If no break is found before 100%, fall through to the existing hard token limit cut.

## Scene Break Priorities

| Priority | Type | Detection | Handling |
|----------|------|-----------|----------|
| 1 | Explicit divider | `***`, `---`, `___`, `* * *`, `===`, `<--->` — lines of repeated separator chars | **Drop** (not spoken) |
| 2 | Chapter/section header | `Chapter N`, `Глава N`, `Book N`, `Prologue`, `Epilogue`, `Пролог`, `Эпилог` — short lines (<50 chars) | **Start next block** |
| 3 | Long narration | >150 chars, no speech symbols (`"`, `«`, `»`, `„`, `"`) | **End current block** |

**Never use double newlines** as break triggers — web novels insert them between every dialogue line for mobile readability.

## Changes

### 1. New private method: `getBreakPriority(sentence: string): number`

Returns the priority rank (1, 2, 3) or 0 if the sentence is not a break candidate.

Detection rules:
- **Priority 1:** Regex `/^[-*_~=]{3,}$/` or exact matches for `* * *`, `<--->`
- **Priority 2:** Regex matching chapter header prefixes (en/ru) + length < 50 chars + no trailing punctuation
- **Priority 3:** Length > 150 chars + no speech symbols present

### 2. Modified method: `splitIntoBlocks(sentences, maxTokens)`

Same signature. Adds `WARNING_THRESHOLD = maxTokens * 0.85`.

In the packing loop, once `currentTokens > WARNING_THRESHOLD`:
1. Check `getBreakPriority(sentence)`
2. If `priority > 0`: cut the block, handle the break sentence per priority rules
3. If `priority === 0` but `currentTokens + tokens > maxTokens`: hard cut (existing behavior)

Break sentence handling:
- Priority 1 (divider): drop the sentence entirely, push current block, start fresh
- Priority 2 (chapter header): push current block, start next block with this sentence
- Priority 3 (long narration): include in current block, push, start next block empty

### 3. No changes to

- `TextBlock` type (unchanged shape)
- `splitIntoParagraphs` (unchanged)
- `createExtractBlocks` / `createAssignBlocks` (inherit behavior from `splitIntoBlocks`)
- Any downstream consumers (Orchestrator, LLMVoiceService)

## Scope of Application

Both `createExtractBlocks` (16k) and `createAssignBlocks` (8k) — semantic breaks benefit both extraction and assignment phases.

## Edge Cases

- **No break found before 100%:** Falls through to hard token limit cut. No behavioral change from current code.
- **Break candidate below 85% threshold:** Ignored. Small blocks would be wasteful.
- **Oversized sentence:** Existing `splitLongSentence` logic runs unchanged before the semantic loop.
- **Divider as only content after a cut:** Dropped (Priority 1), block continues filling from the next sentence.

## Testing

Unit tests in `TextBlockSplitter` test file:
- Priority 1 divider detection and dropping
- Priority 2 chapter header detection and placement in next block
- Priority 3 narration break at threshold
- No break found → hard token limit fallback
- Break below threshold → ignored
- Both 16k (Extract) and 8k (Assign) block sizes produce scene-aware splits
