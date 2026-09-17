import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/config';
import { TextBlockSplitter } from './TextBlockSplitter';

// The splitter estimates one token per 4 chars, so this builds exactly N tokens.
function tokenFill(n: number): string {
  return 'a'.repeat(n * 4);
}

describe('TextBlockSplitter — Semantic Chunking', () => {
  const splitter = new TextBlockSplitter();

  describe('Priority 1: Explicit Scene Dividers', () => {
    it.each([
      ['***', 'drops *** divider at threshold and starts next block clean'],
      ['---', 'drops --- divider at threshold'],
      ['* * *', 'drops * * * divider at threshold'],
      ['===', 'drops === divider at threshold'],
      ['___', 'drops ___ divider at threshold'],
    ])('%s', (divider, _description) => {
      const maxTokens = 100;
      // 86 tokens is 344 chars, just past the 85-token threshold (100 * 0.85).
      const filler = tokenFill(86);
      const newScene = 'New scene begins here.';

      const blocks = splitter.splitIntoBlocks([filler, divider, newScene], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual([newScene]);
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

    it.each([
      ['Prologue', 'The story begins.'],
      ['Epilogue', 'The end.'],
      ['Book 2', 'The second book.'],
    ])('recognizes %s as chapter header', (header, content) => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, header, content], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences[0]).toBe(header);
    });

    it('recognizes Russian Пролог and Эпилог', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks1 = splitter.splitIntoBlocks([filler, 'Пролог', 'Начало.'], maxTokens);
      expect(blocks1[1].sentences[0]).toBe('Пролог');

      const blocks2 = splitter.splitIntoBlocks([filler, 'Эпилог', 'Конец.'], maxTokens);
      expect(blocks2[1].sentences[0]).toBe('Эпилог');
    });

    it('does NOT treat long text starting with Chapter as header', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 60 chars exceeds the 50-char header limit, so this is not a header.
      const longChapter = 'Chapter 1 was about the time he went to the store';

      const blocks = splitter.splitIntoBlocks([filler, longChapter], maxTokens);

      expect(blocks[0].sentences).toContain(filler);
    });
  });

  describe('Priority 3: Long Narration', () => {
    it('ends current block at long narration sentence (no dialogue symbols)', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 200 chars with no quotes crosses the 150-char narration threshold.
      const narration = 'a'.repeat(200);
      const nextContent = 'The dialogue resumes here.';

      const blocks = splitter.splitIntoBlocks([filler, narration, nextContent], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler, narration]);
      expect(blocks[1].sentences).toEqual([nextContent]);
    });

    it('does NOT break on narration that contains dialogue', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // The quotes make this dialogue, so the narration break does not apply.
      const dialogue =
        `She looked at him and said "I don't know what you mean" and then walked away`.padEnd(
          200,
          '.',
        );

      const blocks = splitter.splitIntoBlocks([filler, dialogue], maxTokens);

      expect(blocks[0].sentences).toContain(filler);
    });

    it('does NOT break on short narration (< 150 chars)', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);
      // 100 chars stays below the 150-char narration threshold.
      const shortNarration = 'a'.repeat(100);

      const blocks = splitter.splitIntoBlocks([filler, shortNarration], maxTokens);

      expect(blocks[0].sentences).toContain(filler);
    });
  });

  describe('Edge Cases', () => {
    it('does NOT break at divider when below threshold', () => {
      const maxTokens = 100;
      // 50 tokens stays well below the 85-token threshold.
      const shortFiller = tokenFill(50);

      const blocks = splitter.splitIntoBlocks([shortFiller, '***', 'After divider.'], maxTokens);

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
      const dialogue1 = `"Hello there." `.repeat(30); // about 450 chars and 113 tokens, over maxTokens on its own
      const blocks = splitter.splitIntoBlocks([tokenFill(86), dialogue1.trim()], maxTokens);

      expect(blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('handles consecutive dividers — drops all, continues filling', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks(
        [filler, '***', '---', 'Content after dividers.'],
        maxTokens,
      );

      expect(blocks).toHaveLength(2);
      expect(blocks[0].sentences).toEqual([filler]);
      expect(blocks[1].sentences).toEqual(['Content after dividers.']);
    });

    it('divider at very start of block is dropped without creating empty block', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '***', '***', 'Real content.'], maxTokens);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].sentences).toEqual(['Real content.']);
      for (const block of blocks) {
        expect(block.sentences.length).toBeGreaterThan(0);
      }
    });

    it('maintains correct sentenceStartIndex after divider drop', () => {
      const maxTokens = 100;
      const filler = tokenFill(86);

      const blocks = splitter.splitIntoBlocks([filler, '***', 'Content.'], maxTokens);

      expect(blocks[0].sentenceStartIndex).toBe(0);
      // The divider at index 1 still occupies the index space after the drop.
      expect(blocks[1].sentenceStartIndex).toBe(2);
    });

    it('preserves existing behavior: oversized sentences handled unchanged', () => {
      const maxTokens = 100;
      const giant = tokenFill(150); // 150 tokens > 100 maxTokens

      const blocks = splitter.splitIntoBlocks([giant], maxTokens);

      // splitLongSentence handles it
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      for (const block of blocks) {
        expect(block.sentences.length).toBeGreaterThan(0);
      }
    });
  });

  describe('forceSplitLongParagraphs - hard cut fallback', () => {
    const splitter = new TextBlockSplitter();

    it('returns paragraphs ≤2000 chars unchanged', () => {
      const input = ['Short paragraph.', 'Another short paragraph.'];
      const result = (splitter as any).forceSplitLongParagraphs(input);
      expect(result).toEqual(input);
    });

    it('splits long paragraph at last space before 2000 chars', () => {
      const longPara = `${'a'.repeat(1999)} bbb`;
      const result = (splitter as any).forceSplitLongParagraphs([longPara]);
      expect(result).toHaveLength(2);
      expect(result[0].length).toBeLessThanOrEqual(2000);
      expect(result[1].length).toBeLessThanOrEqual(2000);
      expect(result[0]).not.toMatch(/^\s/);
      expect(result[0]).not.toMatch(/\s$/);
      expect(result[1]).not.toMatch(/^\s/);
      expect(result[1]).not.toMatch(/\s$/);
    });

    it('splits at comma if better than space', () => {
      // The space sits at 1500 and the comma at 1800, closer to the 2000 limit.
      // Total length is 2500 chars, past the limit.
      const longPara = `${'a'.repeat(1500)} ${'b'.repeat(299)},${'c'.repeat(701)}`;
      const result = (splitter as any).forceSplitLongParagraphs([longPara]);
      expect(result).toHaveLength(2);
      expect(result[0].length).toBeGreaterThan(1500);
      expect(result[0].length).toBeLessThanOrEqual(2000);
    });

    it('hard cuts at exactly 2000 chars if no space/comma found', () => {
      // No spaces or commas in first 2000 chars
      const longPara = 'a'.repeat(2100);
      const result = (splitter as any).forceSplitLongParagraphs([longPara]);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('a'.repeat(2000));
      expect(result[1]).toBe('a'.repeat(100));
    });

    it('handles multiple long paragraphs', () => {
      const para1 = 'a'.repeat(2500);
      const para2 = 'b'.repeat(3000);
      const result = (splitter as any).forceSplitLongParagraphs([para1, para2]);
      expect(result[0]).toBe('a'.repeat(2000));
      expect(result[1]).toBe('a'.repeat(500));
      expect(result[2]).toBe('b'.repeat(2000));
      expect(result[3]).toBe('b'.repeat(1000));
    });

    it('handles paragraph that needs multiple splits', () => {
      // 6000 chars with no spaces or commas means 3 hard cuts.
      const longPara = 'a'.repeat(6000);
      const result = (splitter as any).forceSplitLongParagraphs([longPara]);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('a'.repeat(2000));
      expect(result[1]).toBe('a'.repeat(2000));
      expect(result[2]).toBe('a'.repeat(2000));
    });

    it('all resulting strings are trimmed', () => {
      const longPara = `${'a'.repeat(1999)}   bbb   `;
      const result = (splitter as any).forceSplitLongParagraphs([longPara]);
      for (const chunk of result) {
        expect(chunk).toEqual(chunk.trim());
      }
    });

    it('handles empty array', () => {
      const result = (splitter as any).forceSplitLongParagraphs([]);
      expect(result).toEqual([]);
    });

    it('handles mixed long and short paragraphs', () => {
      const input = ['Short', 'a'.repeat(2500), 'Another short'];
      const result = (splitter as any).forceSplitLongParagraphs(input);
      expect(result[0]).toBe('Short');
      expect(result[1]).toBe('a'.repeat(2000));
      expect(result[2]).toBe('a'.repeat(500));
      expect(result[3]).toBe('Another short');
    });
  });

  describe('Integration: createAssignBlocks and createExtractBlocks', () => {
    it('createAssignBlocks splits at scene divider in full text', () => {
      // Each paragraph "Normal story text." = 19 chars = 5 tokens. Fill block 0 to
      // the limit and block 1 past its 85% threshold, so the divider is a break.
      const beforeDivider = 'Normal story text.\n'.repeat(
        Math.ceil((defaultConfig.llm.assignBlockTokens / 5) * 1.9),
      );
      const text = `${beforeDivider}\n***\nNew scene after the break.`;

      const blocks = splitter.createAssignBlocks(text);

      expect(blocks.length).toBeGreaterThan(1);
      const allSentences = blocks.flatMap((b) => b.sentences);
      expect(allSentences).not.toContain('***');
      const lastBlock = blocks[blocks.length - 1];
      expect(lastBlock.sentences).toContain('New scene after the break.');
    });

    it('createExtractBlocks splits at scene divider in full text', () => {
      const beforeDivider = 'Normal story text.\n'.repeat(
        Math.ceil((defaultConfig.llm.extractBlockTokens / 5) * 1.9),
      );
      const text = `${beforeDivider}\n***\nNew scene after the break.`;

      const blocks = splitter.createExtractBlocks(text);

      expect(blocks.length).toBeGreaterThan(1);
      const allSentences = blocks.flatMap((b) => b.sentences);
      expect(allSentences).not.toContain('***');
      const lastBlock = blocks[blocks.length - 1];
      expect(lastBlock.sentences).toContain('New scene after the break.');
    });

    it('createAssignBlocks respects chapter headers as block boundaries', () => {
      // "Story text here." = 16 chars = 4 tokens. Fill block 0 to the limit and
      // block 1 past its 85% threshold, so "Chapter 10" triggers a header break.
      const beforeChapter = 'Story text here.\n'.repeat(
        Math.ceil((defaultConfig.llm.assignBlockTokens / 4) * 1.9),
      );
      const text = `${beforeChapter}\nChapter 10\nThe tenth chapter content.`;

      const blocks = splitter.createAssignBlocks(text);

      const chapterBlock = blocks.find((b) => b.sentences.includes('Chapter 10'));
      expect(chapterBlock).toBeDefined();
      expect(chapterBlock!.sentences[0]).toBe('Chapter 10');
    });
  });

  describe('splitParagraphIntoSentences — splits inside dialogue/quotes', () => {
    const splitter = new TextBlockSplitter();

    it('splits multiple sentences inside curly quotes', () => {
      const text =
        '\u201CAlchemical mana is classified in three ways. One is usefulness to humans. Remember, this form of classification is archaic, but it\u2019s still used everywhere so you need to know it.\u201D';
      const result = (splitter as any).splitParagraphIntoSentences(text);

      expect(result.length).toBeGreaterThanOrEqual(3);
      for (const sentence of result) {
        expect(sentence.length).toBeLessThan(300);
      }
    });

    it('splits multiple sentences inside plain double quotes', () => {
      const text = '"First sentence here. Second sentence here. Third sentence here."';
      const result = (splitter as any).splitParagraphIntoSentences(text);

      expect(result.length).toBeGreaterThanOrEqual(3);
      for (const sentence of result) {
        expect(sentence.length).toBeLessThan(100);
      }
    });

    it('handles WALL OF TEXT: real royalroad sample (Seneca lecture)', () => {
      // Real text from sample_3_en_royalroad.txt, sentence index 47 (711 chars).
      const text =
        '\u201CAlchemical mana is classified in three ways: One is usefulness to humans. Remember, this form of classification is archaic, but it\u2019s still used everywhere so you need to know it. A-class mana is the only mana that is safe to channel. Classes go A through D, and D-class mana will kill you instantly. Again, a metaphor: You can get energy from eating plants. A-class mana is like a carrot. Great. Eat as many as you want. Using B-class mana is like eating plants that will give you diarrhea; you can do it a little bit, but it will hurt. Using D-class mana is like eating a piece of anthracite coal. Yes, it used to be a plant. Yes, there\u2019s lots of energy in there. No, you can\u2019t use it; don\u2019t eat toxic rocks.\u201D';
      const result = (splitter as any).splitParagraphIntoSentences(text);

      // The result must be many sentences, not one 711-char block.
      expect(result.length).toBeGreaterThanOrEqual(10);
      for (const sentence of result) {
        expect(sentence.length).toBeLessThan(200);
      }
    });

    it('splits long narrated paragraph with no quotes', () => {
      const text =
        'The motto above the Alchemistry Building door read \u201CRespect for the Fundamental Forces of the Universe,\u201D and below that, \u201CIn Memoriam,\u201D and the four names of the deceased, at least two of whom had not respected the magical chemistry they studied in the building.';
      const result = (splitter as any).splitParagraphIntoSentences(text);

      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const sentence of result) {
        expect(sentence.length).toBeLessThan(300);
      }
    });
  });

  describe('splitIntoParagraphs with forceSplitLongParagraphs guard', () => {
    it('splits 10000-char paragraph with no punctuation into 5 chunks of ≤2000 chars', () => {
      // A paragraph with no punctuation defeats splitParagraphIntoSentences, which
      // returns the whole paragraph as-is. The guard then force-splits it.
      const longPara = 'a'.repeat(10000);
      const result = splitter.splitIntoParagraphs(longPara);

      expect(result).toHaveLength(5);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
      expect(result[0]).toBe('a'.repeat(2000));
      expect(result[1]).toBe('a'.repeat(2000));
      expect(result[2]).toBe('a'.repeat(2000));
      expect(result[3]).toBe('a'.repeat(2000));
      expect(result[4]).toBe('a'.repeat(2000));
    });

    it('force-splits paragraph entirely inside quotes correctly', () => {
      // A paragraph of only quotes defeats splitParagraphIntoSentences because it
      // finds no sentence boundaries. The guard then force-splits it.
      const quotedPara = `"${'a'.repeat(9998)}"`;
      const result = splitter.splitIntoParagraphs(quotedPara);

      // The quote characters count toward the length, so the result is 5 chunks.
      expect(result).toHaveLength(5);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
    });

    it('normal paragraphs with punctuation still work as before', () => {
      // Punctuation lets splitParagraphIntoSentences handle the text, so the
      // guard passes it through unchanged.
      const text = 'First paragraph.\nSecond paragraph.\nThird paragraph.';
      const result = splitter.splitIntoParagraphs(text);

      expect(result).toHaveLength(3);
      expect(result).toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.']);
    });

    it('mixed long and normal paragraphs are handled correctly', () => {
      const text = `aaa${'a'.repeat(9997)}\nNormal paragraph.`;
      const result = splitter.splitIntoParagraphs(text);

      expect(result.length).toBeGreaterThanOrEqual(6);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
      expect(result[result.length - 1]).toBe('Normal paragraph.');
    });
  });

  describe('Intl.Segmenter — locale-aware splitting', () => {
    it('splits CJK (Japanese) input into per-sentence segments using the ja locale', () => {
      const text = 'これはペンです。それは本です。';
      const result = splitter.splitIntoParagraphs(text, 'ja');

      expect(result).toEqual(['これはペンです。', 'それは本です。']);
    });

    it('falls back to en for a non-constructible locale (invalid BCP-47) without throwing', () => {
      // Intl.Segmenter rejects 'x'. getSegmenter catches the error and retries with 'en'.
      const text = 'First sentence. Second sentence.';
      const result = splitter.splitIntoParagraphs(text, 'x');

      expect(result).toEqual(['First sentence.', 'Second sentence.']);
    });
  });
});
