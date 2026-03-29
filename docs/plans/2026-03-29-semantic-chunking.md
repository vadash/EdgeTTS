# Semantic Chunking (Scene Breaks) Implementation Plan

**Goal:** Make `TextBlockSplitter.splitIntoBlocks` prefer natural scene boundaries over arbitrary token-limit cuts.
**Architecture:** Add a private `getBreakPriority` helper that ranks sentences as break candidates (1=divider, 2=chapter header, 3=narration). Modify the `splitIntoBlocks` packing loop to check for breaks once past 85% of `maxTokens`. A private `hasDialogueSymbols` regex avoids a cross-layer dependency on `LLMVoiceService.hasSpeechSymbols`.
**Tech Stack:** TypeScript, Vitest

---

### File Structure Overview

- **Create:** `src/services/TextBlockSplitter.test.ts` — unit tests for scene break detection
- **Modify:** `src/services/TextBlockSplitter.ts` — add `getBreakPriority`, `hasDialogueSymbols`, modify `splitIntoBlocks`

---

### Task 1: Priority 1 — Explicit Scene Dividers (Dropped)

**Files:**
- Create: `src/services/TextBlockSplitter.test.ts`
- Modify: `src/services/TextBlockSplitter.ts`

**Common Pitfalls:**
- `estimateTokens` uses `Math.ceil(text.length / 4)`. To get exactly N tokens, use N×4 characters.
- Priority 1 dividers must be the **entire trimmed line**, not a substring — `"***hello"` is not a divider.
- Don't import `hasSpeechSymbols` from `LLMVoiceService` — wrong dependency direction. Define a simple private `hasDialogueSymbols` in `TextBlockSplitter` instead.

- [ ] Step 1: Write the failing test

```typescript
import { describe, expect, it } from 'vitest';
import { TextBlockSplitter } from './TextBlockSplitter';

// Helper: create a string that estimates to exactly N tokens (4 chars per token)
function tokenFill(n: number): string {
  return 'a'.repeat(n * 4);
}

describe('TextBlockSplitter — Semantic Chunking', () => {
  const splitter = new TextBlockSplitter();

  describe('Priority 1: Explicit Scene Dividers', () => {
    it('drops *** divider at threshold and starts next block clean', () => {
      const maxTokens = 100;
      // 86 tokens = 344 chars > 85 threshold (100 * 0.85 = 85)
      const filler = tokenFill(86);
      const divider = '***';
      const newScene = 'New scene begins here.';

      const blocks = splitter.splitIntoBlocks([filler, divider, newScene], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      // divider dropped, newScene starts block 1
      expect(blocks[1].sentences).toEqual([newScene]);
    });

    it('drops --- divider at threshold', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '---', 'After divider.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual(['After divider.']);
    });

    it('drops * * * divider at threshold', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '* * *', 'After divider.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual(['After divider.']);
    });

    it('drops === divider at threshold', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '===', 'After divider.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual(['After divider.']);
    });

    it('drops ___ divider at threshold', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '___', 'After divider.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual(['After divider.']);
    });
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: FAIL — divider `"***"` is not dropped, it appears inside a block.

- [ ] Step 3: Write minimal implementation

Add two private methods to `TextBlockSplitter` class (before `splitIntoBlocks`, around line 117):

```typescript
  /**
   * Check if sentence contains dialogue symbols (simplified check for narration detection).
   * Avoids importing hasSpeechSymbols from LLMVoiceService (wrong dependency direction).
   */
  private hasDialogueSymbols(text: string): boolean {
    // Straight quotes, guillemets, curly quotes, em dash (Russian dialogue)
    return /["\u00AB\u00BB\u2014\u201C\u201D\u201E\u2039\u203A\u2018]/.test(text);
  }

  /**
   * Rank a sentence as a scene break candidate.
   * Returns: 1 = explicit divider, 2 = chapter header, 3 = long narration, 0 = not a break.
   */
  private getBreakPriority(sentence: string): number {
    const trimmed = sentence.trim();

    // Priority 1: Explicit scene dividers (entire line is separator characters)
    if (/^[-*_~=]{3,}$/.test(trimmed) || trimmed === '* * *' || trimmed === '<--->') {
      return 1;
    }

    // Priority 2: Chapter/section headers — TODO in Task 2
    // Priority 3: Long narration — TODO in Task 3

    return 0;
  }
```

Replace the `splitIntoBlocks` method (lines 119–184) with:

```typescript
  /**
   * Split sentences into blocks for LLM processing.
   * Prefers semantic scene breaks over arbitrary token-limit cuts.
   */
  splitIntoBlocks(sentences: string[], maxTokens: number = 16000): TextBlock[] {
    const blocks: TextBlock[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;
    let sentenceStartIndex = 0;
    let blockIndex = 0;
    const WARNING_THRESHOLD = maxTokens * 0.85;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const tokens = this.estimateTokens(sentence);

      // Handle oversized sentence
      if (tokens > maxTokens) {
        if (currentBlock.length > 0) {
          blocks.push({
            blockIndex: blockIndex++,
            sentences: currentBlock,
            sentenceStartIndex,
          });
          currentBlock = [];
          currentTokens = 0;
          sentenceStartIndex = i;
        }
        // Split long sentence
        const chunks = this.splitLongSentence(sentence, maxTokens);
        for (const chunk of chunks) {
          blocks.push({
            blockIndex: blockIndex++,
            sentences: [chunk],
            sentenceStartIndex: i,
          });
        }
        sentenceStartIndex = i + 1;
        continue;
      }

      // Semantic break: check when past warning threshold
      if (currentTokens > WARNING_THRESHOLD) {
        const priority = this.getBreakPriority(sentence);

        if (priority === 1) {
          // Divider: push current block, drop this sentence
          if (currentBlock.length > 0) {
            blocks.push({
              blockIndex: blockIndex++,
              sentences: currentBlock,
              sentenceStartIndex,
            });
          }
          currentBlock = [];
          currentTokens = 0;
          sentenceStartIndex = i + 1;
          continue;
        }

        if (priority === 2) {
          // Chapter header: push current block, this sentence starts next block
          // Will be handled in Task 2
        }

        if (priority === 3) {
          // Long narration: add to current block, then push
          // Will be handled in Task 3
        }
      }

      // Hard cut: token limit (original behavior)
      if (currentTokens + tokens > maxTokens && currentBlock.length > 0) {
        blocks.push({
          blockIndex: blockIndex++,
          sentences: currentBlock,
          sentenceStartIndex,
        });
        currentBlock = [];
        currentTokens = 0;
        sentenceStartIndex = i;
      }

      currentBlock.push(sentence);
      currentTokens += tokens;
    }

    // Final block
    if (currentBlock.length > 0) {
      blocks.push({
        blockIndex: blockIndex++,
        sentences: currentBlock,
        sentenceStartIndex,
      });
    }

    return blocks;
  }
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: All 5 Priority 1 tests PASS.

- [ ] Step 5: Commit

```bash
git add src/services/TextBlockSplitter.ts src/services/TextBlockSplitter.test.ts && git commit -m "feat(splitter): add Priority 1 scene divider detection and dropping"
```

---

### Task 2: Priority 2 — Chapter/Section Headers (Start Next Block)

**Files:**
- Modify: `src/services/TextBlockSplitter.test.ts`
- Modify: `src/services/TextBlockSplitter.ts`

- [ ] Step 1: Write the failing tests

Append to the `describe('TextBlockSplitter — Semantic Chunking')` block:

```typescript
  describe('Priority 2: Chapter/Section Headers', () => {
    it('places Chapter header as first sentence of next block', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      const header = 'Chapter 5';
      const content = 'The next chapter begins here.';

      const blocks = splitter.splitIntoBlocks([filler, header, content], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual([header, content]);
    });

    it('recognizes Russian chapter header (Глава)', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, 'Глава 3', 'Текст новой главы.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences[0]).toBe('Глава 3');
    });

    it('recognizes Prologue as chapter header', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, 'Prologue', 'The story begins.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences[0]).toBe('Prologue');
    });

    it('recognizes Epilogue as chapter header', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, 'Epilogue', 'The end.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences[0]).toBe('Epilogue');
    });

    it('recognizes Russian Пролог and Эпилог', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks1 = splitter.splitIntoBlocks([filler, 'Пролог', 'Начало.'], maxTokens);
      expect(blocks1[1].sentences[0]).toBe('Пролог');

      const blocks2 = splitter.splitIntoBlocks([filler, 'Эпилог', 'Конец.'], maxTokens);
      expect(blocks2[1].sentences[0]).toBe('Эпилог');
    });

    it('recognizes Book N as chapter header', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, 'Book 2', 'The second book.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences[0]).toBe('Book 2');
    });

    it('does NOT treat long text starting with Chapter as header', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 60 chars — too long for a header (< 50 chars)
      const longChapter = 'Chapter 1 was about the time he went to the store';

      const blocks = splitter.splitIntoBlocks([filler, longChapter], maxTokens);

      // Should NOT split — not recognized as header, hard cut applies
      expect(blocks[0].sentences).toContain(filler);
    });
  });
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: Priority 2 tests FAIL — headers are not recognized.

- [ ] Step 3: Add Priority 2 detection

Update `getBreakPriority` in `TextBlockSplitter.ts` — add the Priority 2 block after the Priority 1 check:

```typescript
    // Priority 2: Chapter/section headers (short lines, <50 chars)
    if (trimmed.length < 50 && trimmed.length > 0) {
      if (/^(Chapter|Глава|Book|Prologue|Epilogue|Пролог|Эпилог)\s*\d*\s*$/i.test(trimmed)) {
        return 2;
      }
    }
```

Update the `priority === 2` branch in `splitIntoBlocks`:

```typescript
        if (priority === 2) {
          // Chapter header: push current block, this sentence starts next block
          if (currentBlock.length > 0) {
            blocks.push({
              blockIndex: blockIndex++,
              sentences: currentBlock,
              sentenceStartIndex,
            });
          }
          currentBlock = [];
          currentTokens = 0;
          sentenceStartIndex = i;
          // Fall through: sentence will be added to the new block
        }
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: All Priority 1 + Priority 2 tests PASS.

- [ ] Step 5: Commit

```bash
git add src/services/TextBlockSplitter.ts src/services/TextBlockSplitter.test.ts && git commit -m "feat(splitter): add Priority 2 chapter header detection"
```

---

### Task 3: Priority 3 — Long Narration (Ends Current Block)

**Files:**
- Modify: `src/services/TextBlockSplitter.test.ts`
- Modify: `src/services/TextBlockSplitter.ts`

- [ ] Step 1: Write the failing tests

Append to the `describe('TextBlockSplitter — Semantic Chunking')` block:

```typescript
  describe('Priority 3: Long Narration', () => {
    it('ends current block at long narration sentence (no dialogue symbols)', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 200 chars, no quotes — pure narration
      const narration = 'a'.repeat(200);
      const nextContent = 'The dialogue resumes here.';

      const blocks = splitter.splitIntoBlocks([filler, narration, nextContent], maxTokens);

      expect(blocks).toHaveLength(2);
      // Narration ends block 0
      expect(blocks[0].sentences).toEqual([filler, narration]);
      // Next content starts block 1
      expect(blocks[1].sentences).toEqual([nextContent]);
    });

    it('does NOT break on narration that contains dialogue', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // Long text but has quotes — it's dialogue, not narration
      const dialogue = `She looked at him and said "I don't know what you mean" and then walked away`.padEnd(200, '.');

      const blocks = splitter.splitIntoBlocks([filler, dialogue], maxTokens);

      // Should NOT split at this sentence — it has dialogue symbols
      // Falls through to hard token limit
      expect(blocks[0].sentences).toContain(filler);
    });

    it('does NOT break on short narration (< 150 chars)', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 100 chars, no quotes — but too short
      const shortNarration = 'a'.repeat(100);

      const blocks = splitter.splitIntoBlocks([filler, shortNarration], maxTokens);

      // Should NOT split — narration too short (< 150 chars)
      expect(blocks[0].sentences).toContain(filler);
    });
  });
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: Priority 3 tests FAIL — narration breaks are not detected.

- [ ] Step 3: Add Priority 3 detection

Update `getBreakPriority` in `TextBlockSplitter.ts` — add the Priority 3 block after Priority 2:

```typescript
    // Priority 3: Long narration (no dialogue symbols, >150 chars)
    if (trimmed.length > 150 && !this.hasDialogueSymbols(trimmed)) {
      return 3;
    }
```

Update the `priority === 3` branch in `splitIntoBlocks`:

```typescript
        if (priority === 3) {
          // Long narration: include in current block, then push
          currentBlock.push(sentence);
          currentTokens += tokens;
          blocks.push({
            blockIndex: blockIndex++,
            sentences: currentBlock,
            sentenceStartIndex,
          });
          currentBlock = [];
          currentTokens = 0;
          sentenceStartIndex = i + 1;
          continue;
        }
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: All Priority 1 + 2 + 3 tests PASS.

- [ ] Step 5: Commit

```bash
git add src/services/TextBlockSplitter.ts src/services/TextBlockSplitter.test.ts && git commit -m "feat(splitter): add Priority 3 long narration break detection"
```

---

### Task 4: Edge Cases — Threshold Guard, Hard Cut Fallback, Consecutive Dividers

**Files:**
- Modify: `src/services/TextBlockSplitter.test.ts`

- [ ] Step 1: Write the edge case tests

Append to the `describe('TextBlockSplitter — Semantic Chunking')` block:

```typescript
  describe('Edge Cases', () => {
    it('does NOT break at divider when below threshold', () => {
      const maxTokens = 100;
      // Only 50 tokens — well below 85 threshold
      const shortFiller = tokenFill(50);

      const blocks = splitter.splitIntoBlocks([shortFiller, '***', 'After divider.'], maxTokens);

      // All in one block — threshold not reached, divider is just content
      expect(blocks).toHaveLength(1);
      expect(blocks[0].sentences).toEqual([shortFiller, '***', 'After divider.']);
    });

    it('does NOT break at chapter header when below threshold', () => {
      const maxTokens = 100;
      const shortFiller = tokenFill(50);

      const blocks = splitter.splitIntoBlocks([shortFiller, 'Chapter 5', 'Content.'], maxTokens);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].sentences).toEqual([shortFiller, 'Chapter 5', 'Content.']);
    });

    it('falls through to hard token cut when no break candidate found', () => {
      const maxTokens = 100;
      // 60 tokens of dialogue, then 60 more of dialogue — no break candidates
      const dialogue1 = `"Hello there." `.repeat(30); // ~450 chars ≈ 113 tokens
      // This single sentence exceeds maxTokens on its own after the first is added
      const blocks = splitter.splitIntoBlocks([tokenFill(86), dialogue1.trim()], maxTokens);

      // Hard cut at token limit — dialogue1 causes split
      expect(blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('handles consecutive dividers — drops all, continues filling', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '***', '---', 'Content after dividers.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      // Both dividers dropped
      expect(blocks[1].sentences).toEqual(['Content after dividers.']);
    });

    it('divider at very start of block is dropped without creating empty block', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      // After cut, next sentence is a divider, then content
      const blocks = splitter.splitIntoBlocks([filler, '***', '***', 'Real content.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences).toEqual(['Real content.']);
      // No empty blocks
      for (const block of blocks) {
        expect(block.sentences.length).toBeGreaterThan(0);
      }
    });

    it('maintains correct sentenceStartIndex after divider drop', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '***', 'Content.'], maxTokens);

      expect(blocks[0].sentenceStartIndex).toBe(0);
      // Content is at index 2, divider (index 1) was dropped
      expect(blocks[1].sentenceStartIndex).toBe(2);
    });

    it('maintains correct sentenceStartIndex after chapter header split', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, 'Chapter 5', 'Content.'], maxTokens);

      expect(blocks[0].sentenceStartIndex).toBe(0);
      // Chapter 5 is at index 1
      expect(blocks[1].sentenceStartIndex).toBe(1);
    });

    it('maintains correct sentenceStartIndex after narration break', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      const narration = 'a'.repeat(200);

      const blocks = splitter.splitIntoBlocks([filler, narration, 'Content.'], maxTokens);

      expect(blocks[0].sentenceStartIndex).toBe(0);
      // Narration is included in block 0, Content at index 2 starts block 1
      expect(blocks[1].sentenceStartIndex).toBe(2);
    });

    it('preserves existing behavior: oversized sentences handled unchanged', () => {
      const maxTokens = 100;
      const giant = tokenFill(150); // 150 tokens > 100 maxTokens

      const blocks = splitter.splitIntoBlocks([giant], maxTokens);

      // splitLongSentence handles it
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      // No crash, blocks are created
      for (const block of blocks) {
        expect(block.sentences.length).toBeGreaterThan(0);
      }
    });
  });
```

- [ ] Step 2: Run all tests

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: All edge case tests PASS (behavior already implemented in Tasks 1–3).

- [ ] Step 3: Commit

```bash
git add src/services/TextBlockSplitter.test.ts && git commit -m "test(splitter): add edge case tests for semantic chunking"
```

---

### Task 5: Integration — createAssignBlocks and createExtractBlocks with Scene Breaks

**Files:**
- Modify: `src/services/TextBlockSplitter.test.ts`

- [ ] Step 1: Write the integration tests

Append to the `describe('TextBlockSplitter — Semantic Chunking')` block:

```typescript
  describe('Integration: createAssignBlocks and createExtractBlocks', () => {
    it('createAssignBlocks (8k) splits at scene divider in full text', () => {
      // Build text with a scene divider near the 8k token limit
      // 8k tokens = 32000 chars. 85% = 6800 tokens = 27200 chars.
      const beforeDivider = 'Normal story text.\n'.repeat(2000); // ~38k chars → ~9.5k tokens
      const text = beforeDivider + '\n***\n' + 'New scene after the break.';

      const blocks = splitter.createAssignBlocks(text);

      // Should produce multiple blocks, with a clean split at the divider
      expect(blocks.length).toBeGreaterThan(1);
      // No block should contain the raw '***' divider
      const allSentences = blocks.flatMap((b) => b.sentences);
      expect(allSentences).not.toContain('***');
      // Last block should contain the new scene text
      const lastBlock = blocks[blocks.length - 1];
      expect(lastBlock.sentences).toContain('New scene after the break.');
    });

    it('createExtractBlocks (16k) splits at scene divider in full text', () => {
      // 16k tokens = 64000 chars. 85% = 13600 tokens = 54400 chars.
      const beforeDivider = 'Normal story text.\n'.repeat(4000); // ~76k chars → ~19k tokens
      const text = beforeDivider + '\n***\n' + 'New scene after the break.';

      const blocks = splitter.createExtractBlocks(text);

      expect(blocks.length).toBeGreaterThan(1);
      const allSentences = blocks.flatMap((b) => b.sentences);
      expect(allSentences).not.toContain('***');
      const lastBlock = blocks[blocks.length - 1];
      expect(lastBlock.sentences).toContain('New scene after the break.');
    });

    it('createAssignBlocks respects chapter headers as block boundaries', () => {
      const beforeChapter = 'Story text here.\n'.repeat(1500); // ~22k chars → ~5.5k tokens
      const text = beforeChapter + '\nChapter 10\n' + 'The tenth chapter content.';

      const blocks = splitter.createAssignBlocks(text);

      // Find the block containing "Chapter 10"
      const chapterBlock = blocks.find((b) => b.sentences.includes('Chapter 10'));
      expect(chapterBlock).toBeDefined();
      // Chapter 10 should be the first sentence in its block
      expect(chapterBlock!.sentences[0]).toBe('Chapter 10');
    });
  });
```

- [ ] Step 2: Run all tests

Run: `npx vitest run src/services/TextBlockSplitter.test.ts`
Expected: All tests PASS.

- [ ] Step 3: Run full test suite to verify no regressions

Run: `npm test`
Expected: All tests PASS across the entire project.

- [ ] Step 4: Commit

```bash
git add src/services/TextBlockSplitter.test.ts && git commit -m "test(splitter): add integration tests for createAssignBlocks and createExtractBlocks"
```
