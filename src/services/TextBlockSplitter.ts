import type { TextBlock } from '@/state/types';

/**
 * TextBlockSplitter - Splits text into paragraphs and blocks for LLM processing
 * Each line (\n) is a paragraph. Large paragraphs (>3000 chars) are split by sentence boundaries.
 */
export class TextBlockSplitter {
  /**
   * Estimate token count for text (approximation: chars / 4)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Split text into paragraphs (one per line)
   * Large paragraphs (>3000 chars) are split by sentence boundaries
   */
  splitIntoParagraphs(text: string): string[] {
    const paragraphs: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.length > 3000) {
        const sentences = this.splitParagraphIntoSentences(trimmed);
        paragraphs.push(...sentences);
      } else {
        paragraphs.push(trimmed);
      }
    }

    return paragraphs;
  }

  /**
   * Split a large paragraph into sentences (used for paragraphs >3000 chars)
   * Handles: .!?… and preserves abbreviations
   * Quote-aware: doesn't split inside quoted text
   */
  private splitParagraphIntoSentences(paragraph: string): string[] {
    const sentences: string[] = [];
    // Normalize line breaks within paragraph to spaces
    const text = paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1] || '';
      const next2 = text[i + 2] || '';

      // Track quote state (handle various quote characters)
      if (char === '"' || char === '"' || char === '«') {
        if (!inQuotes) {
          inQuotes = true;
        }
      } else if (char === '"' || char === '"' || char === '»') {
        if (inQuotes) {
          inQuotes = false;
        }
      }

      // Handle ellipsis
      if (char === '.' && next === '.' && next2 === '.') {
        current += '...';
        i += 2;
        continue;
      }

      current += char;

      // Split on sentence-ending punctuation ONLY if not inside quotes
      if (/[.!?…]/.test(char) && !inQuotes) {
        const atEnd = i === text.length - 1;
        const beforeSpace = /\s/.test(next);

        if ((atEnd || beforeSpace) && !this.isAbbreviation(current)) {
          const trimmed = current.trim();
          if (trimmed && this.isPronounceable(trimmed)) {
            sentences.push(trimmed);
          }
          current = '';
        }
      }
    }

    // Add remaining text
    const remaining = current.trim();
    if (remaining && this.isPronounceable(remaining)) {
      sentences.push(remaining);
    }

    return sentences;
  }

  /**
   * Check for common abbreviations (en/ru)
   */
  private isAbbreviation(text: string): boolean {
    const t = text.trimEnd();
    // Mr. Mrs. Dr. Prof. т.д. т.п. и т.д. г. гг.
    return /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Inc|Ltd|т|п|д|г|гг|др|пр|ул|и)\.\s*$/i.test(t);
  }

  /**
   * Check if text has pronounceable content
   */
  private isPronounceable(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
  }

  /**
   * Split sentences into blocks for LLM processing
   */
  splitIntoBlocks(sentences: string[], maxTokens: number = 16000): TextBlock[] {
    const blocks: TextBlock[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;
    let sentenceStartIndex = 0;
    let blockIndex = 0;

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

      // Start new block if would exceed limit
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

  /**
   * Split oversized sentence by clause separators
   */
  private splitLongSentence(sentence: string, maxTokens: number): string[] {
    const chunks: string[] = [];
    const maxChars = maxTokens * 4;
    const separators = ['; ', ', ', ' — ', ' - ', ' '];
    let remaining = sentence;

    while (remaining.length > maxChars) {
      let splitPoint = maxChars;
      for (const sep of separators) {
        const idx = remaining.lastIndexOf(sep, maxChars);
        if (idx > maxChars / 2) {
          splitPoint = idx + sep.length;
          break;
        }
      }
      chunks.push(remaining.slice(0, splitPoint).trim());
      remaining = remaining.slice(splitPoint).trim();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  /**
   * Create blocks for Extract (character extraction) - larger blocks
   */
  createExtractBlocks(text: string): TextBlock[] {
    const paragraphs = this.splitIntoParagraphs(text);
    return this.splitIntoBlocks(paragraphs, 16000);
  }

  /**
   * Create blocks for Assign (speaker assignment) - smaller blocks
   */
  createAssignBlocks(text: string): TextBlock[] {
    const paragraphs = this.splitIntoParagraphs(text);
    return this.splitIntoBlocks(paragraphs, 8000);
  }
}

export const textBlockSplitter = new TextBlockSplitter();
