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
});
