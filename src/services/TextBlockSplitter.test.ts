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
