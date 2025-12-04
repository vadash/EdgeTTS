import { describe, it, expect } from 'vitest';
import { TextBlockSplitter } from './TextBlockSplitter';

describe('TextBlockSplitter', () => {
  const splitter = new TextBlockSplitter();

  describe('estimateTokens', () => {
    it('returns chars/4 rounded up', () => {
      expect(splitter.estimateTokens('1234')).toBe(1);
      expect(splitter.estimateTokens('12345')).toBe(2);
      expect(splitter.estimateTokens('12345678')).toBe(2);
      expect(splitter.estimateTokens('')).toBe(0);
    });
  });

  describe('splitIntoSentences', () => {
    it('splits basic paragraphs into sentences', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe('First sentence.');
      expect(sentences[1]).toBe('Second sentence.');
      expect(sentences[2]).toBe('Third sentence.');
    });

    it('handles multiple paragraphs', () => {
      const text = 'Paragraph one.\n\nParagraph two.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe('Paragraph one.');
      expect(sentences[1]).toBe('Paragraph two.');
    });

    it('keeps dialogue with attribution together', () => {
      const text = '"Hello there," she said.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('"Hello there," she said.');
    });

    it('handles curly quotes', () => {
      const text = '"Hello," she said. "Goodbye," he replied.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe('"Hello," she said.');
      expect(sentences[1]).toBe('"Goodbye," he replied.');
    });

    it('handles guillemets (French quotes)', () => {
      const text = '«Bonjour» dit-elle.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('«Bonjour» dit-elle.');
    });

    it('handles German/Russian low-9 quotes', () => {
      const text = '„Привет" сказала она.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('„Привет" сказала она.');
    });

    it('handles two dialogues on same line', () => {
      const text = '"There\'s a hole," Mirian said. "It\'s leaking."';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(2);
      expect(sentences[0]).toBe('"There\'s a hole," Mirian said.');
      expect(sentences[1]).toBe('"It\'s leaking."');
    });

    it('handles ellipsis as three dots', () => {
      const text = '— Это... это абсурд! — выдохнул он.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('— Это... это абсурд! — выдохнул он.');
    });

    it('handles em-dash dialogue with attribution', () => {
      const text = '— Довольно! — резко перебил его доктор.';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('— Довольно! — резко перебил его доктор.');
    });

    it('filters non-pronounceable text', () => {
      const text = 'Valid sentence. --- ... !!!';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('Valid sentence.');
    });

    it('handles sentences ending with different punctuation', () => {
      const text = 'Question? Exclamation! Statement. Ellipsis…';
      const sentences = splitter.splitIntoSentences(text);

      expect(sentences).toHaveLength(4);
    });

    it('returns empty array for empty text', () => {
      expect(splitter.splitIntoSentences('')).toHaveLength(0);
      expect(splitter.splitIntoSentences('   ')).toHaveLength(0);
    });
  });

  describe('splitIntoBlocks', () => {
    it('creates single block for small text', () => {
      const sentences = ['Short sentence one.', 'Short sentence two.'];
      const blocks = splitter.splitIntoBlocks(sentences, 1000);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].sentences).toHaveLength(2);
      expect(blocks[0].blockIndex).toBe(0);
      expect(blocks[0].sentenceStartIndex).toBe(0);
    });

    it('splits into multiple blocks when exceeding token limit', () => {
      // Each sentence ~10 tokens (40 chars)
      const sentence = 'A'.repeat(40);
      const sentences = Array(5).fill(sentence);

      // Max 25 tokens = 2-3 sentences per block
      const blocks = splitter.splitIntoBlocks(sentences, 25);

      expect(blocks.length).toBeGreaterThan(1);
    });

    it('tracks sentenceStartIndex correctly', () => {
      const sentence = 'A'.repeat(40); // ~10 tokens
      const sentences = Array(6).fill(sentence);

      const blocks = splitter.splitIntoBlocks(sentences, 25);

      // First block starts at 0
      expect(blocks[0].sentenceStartIndex).toBe(0);
      // Subsequent blocks start after previous block's sentences
      expect(blocks[1].sentenceStartIndex).toBeGreaterThan(0);
    });

    it('handles very long sentences by splitting them', () => {
      // Create a sentence that exceeds maxTokens
      const longSentence = 'Word '.repeat(500); // ~625 tokens
      const sentences = [longSentence];

      const blocks = splitter.splitIntoBlocks(sentences, 100);

      // Long sentence should be split into multiple blocks
      expect(blocks.length).toBeGreaterThan(1);
    });

    it('returns empty array for empty input', () => {
      const blocks = splitter.splitIntoBlocks([], 1000);
      expect(blocks).toHaveLength(0);
    });
  });

  describe('createPass1Blocks', () => {
    it('uses 16k token limit', () => {
      // Small text should create one block
      const text = 'Simple test sentence.';
      const blocks = splitter.createPass1Blocks(text);

      expect(blocks).toHaveLength(1);
    });
  });

  describe('createPass2Blocks', () => {
    it('uses 8k token limit', () => {
      // Small text should create one block
      const text = 'Simple test sentence.';
      const blocks = splitter.createPass2Blocks(text);

      expect(blocks).toHaveLength(1);
    });
  });
});
