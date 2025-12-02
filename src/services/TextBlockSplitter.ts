import type { TextBlock } from '@/state/types';

/**
 * TextBlockSplitter - Splits text into sentences and blocks for LLM processing
 */
export class TextBlockSplitter {
  /**
   * Estimate token count for text (approximation: chars / 4)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Split text into sentences
   * Handles multiple sentence-ending punctuation marks and preserves them
   */
  splitIntoSentences(text: string): string[] {
    const sentences: string[] = [];

    // Regex to match sentence boundaries
    // Matches: . ! ? followed by space/newline, or end of string
    // Also handles Russian quotes and em-dashes
    const sentenceRegex = /[^.!?…]*[.!?…]+(?:\s+|$)|[^.!?…]+$/g;

    // Split by paragraphs first to preserve structure
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;

      // Handle lines within paragraph
      const lines = paragraph.split(/\n/);

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Try to split by sentence boundaries
        const matches = trimmedLine.match(sentenceRegex);

        if (matches) {
          for (const match of matches) {
            const sentence = match.trim();
            if (sentence && this.isPronounceable(sentence)) {
              sentences.push(sentence);
            }
          }
        } else if (this.isPronounceable(trimmedLine)) {
          // Fallback: entire line is one sentence
          sentences.push(trimmedLine);
        }
      }
    }

    return sentences;
  }

  /**
   * Check if text contains pronounceable characters (letters or numbers)
   */
  private isPronounceable(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
  }

  /**
   * Split sentences into blocks, respecting token limits
   * @param sentences - Array of sentences
   * @param maxTokens - Maximum tokens per block (default 16000 for Pass 1, 8000 for Pass 2)
   * @returns Array of TextBlock objects
   */
  splitIntoBlocks(sentences: string[], maxTokens: number = 16000): TextBlock[] {
    const blocks: TextBlock[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;
    let sentenceStartIndex = 0;
    let blockIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.estimateTokens(sentence);

      // If single sentence exceeds max, split it (rare edge case)
      if (sentenceTokens > maxTokens) {
        // Save current block first
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

        // Split long sentence by chunks
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

      // Check if adding this sentence would exceed limit
      if (currentTokens + sentenceTokens > maxTokens && currentBlock.length > 0) {
        // Save current block
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
      currentTokens += sentenceTokens;
    }

    // Add final block
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
   * Split a very long sentence into smaller chunks
   */
  private splitLongSentence(sentence: string, maxTokens: number): string[] {
    const chunks: string[] = [];
    const maxChars = maxTokens * 4; // Convert back to chars

    // Try to split by clause separators
    const separators = ['; ', ', ', ' - ', ' — ', ' '];
    let remaining = sentence;

    while (remaining.length > maxChars) {
      let splitPoint = maxChars;

      // Try to find a good split point
      for (const sep of separators) {
        const lastSep = remaining.lastIndexOf(sep, maxChars);
        if (lastSep > maxChars / 2) {
          splitPoint = lastSep + sep.length;
          break;
        }
      }

      chunks.push(remaining.slice(0, splitPoint).trim());
      remaining = remaining.slice(splitPoint).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Create blocks specifically for Pass 1 (character extraction)
   * Uses larger block size since output is small
   */
  createPass1Blocks(text: string): TextBlock[] {
    const sentences = this.splitIntoSentences(text);
    return this.splitIntoBlocks(sentences, 16000); // ~16k tokens
  }

  /**
   * Create blocks specifically for Pass 2 (speaker assignment)
   * Uses smaller block size since output includes per-sentence data
   */
  createPass2Blocks(text: string): TextBlock[] {
    const sentences = this.splitIntoSentences(text);
    return this.splitIntoBlocks(sentences, 8000); // ~8k tokens
  }
}

export const textBlockSplitter = new TextBlockSplitter();
