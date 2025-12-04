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
   * Quote-aware splitting that keeps dialogue + attribution together
   */
  splitIntoSentences(text: string): string[] {
    const sentences: string[] = [];

    // Split by paragraphs first to preserve structure
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;

      // Handle lines within paragraph
      const lines = paragraph.split(/\n/);

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // Quote-aware sentence splitting
        const lineSentences = this.splitLineIntoSentences(trimmedLine);
        for (const sentence of lineSentences) {
          if (sentence && this.isPronounceable(sentence)) {
            sentences.push(sentence);
          }
        }
      }
    }

    return sentences;
  }

  /**
   * Split a single line into sentences, respecting quote boundaries and em-dash dialogue
   * Keeps "dialogue" attribution together as one sentence
   */
  private splitLineIntoSentences(line: string): string[] {
    const sentences: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let inEmDashDialogue = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1] || '';
      const next2Char = line[i + 2] || '';

      // Skip ellipsis: handle ... as single unit
      if (char === '.' && nextChar === '.' && next2Char === '.') {
        current += '...';
        i += 2; // skip next two dots
        continue;
      }

      current += char;

      // Track em-dash dialogue (Russian style: — dialogue — attribution)
      if (char === '—' || char === '–') {
        if (!inQuote && !inEmDashDialogue && /\s/.test(nextChar)) {
          // Opening em-dash at start or after space
          inEmDashDialogue = true;
        } else if (inEmDashDialogue && /\s/.test(nextChar)) {
          // Second em-dash - attribution follows
          // Look for attribution end
          const remaining = line.slice(i + 1);
          const attrMatch = remaining.match(/^(\s*[a-zа-яёA-ZА-ЯЁ][^.!?…]*[.!?…])/);
          if (attrMatch) {
            current += attrMatch[1];
            i += attrMatch[1].length;
            inEmDashDialogue = false;

            if (current.trim()) {
              sentences.push(current.trim());
              current = '';
            }
            continue;
          }
        }
      }

      // Track quote state - opening quote
      if (this.isOpeningQuote(char) && !inQuote) {
        inQuote = true;
        quoteChar = char;
      }
      // Closing quote
      else if (inQuote && this.isClosingQuote(char, quoteChar)) {
        inQuote = false;
        quoteChar = '';

        // After closing quote, look for attribution: "..." she said.
        // Include attribution in same sentence
        const remaining = line.slice(i + 1);
        const attrMatch = remaining.match(/^(\s*[—\-–,]?\s*[a-zа-яёA-ZА-ЯЁ][^.!?…]*[.!?…])/);
        if (attrMatch) {
          current += attrMatch[1];
          i += attrMatch[1].length;

          // End sentence after quote + attribution
          if (current.trim()) {
            sentences.push(current.trim());
            current = '';
          }
          continue;
        }

        // No attribution - end sentence after closing quote if followed by space/end
        if (/\s/.test(nextChar) || i === line.length - 1) {
          if (current.trim()) {
            sentences.push(current.trim());
            current = '';
          }
        }
      }
      // Only split on sentence-ending punct when outside quotes and em-dash dialogue
      else if (!inQuote && !inEmDashDialogue && /[.!?…]/.test(char)) {
        // Check if followed by space or end (not mid-word like "Dr.")
        if (/\s/.test(nextChar) || i === line.length - 1) {
          if (current.trim()) {
            sentences.push(current.trim());
            current = '';
          }
        }
      }
    }

    // Add remaining text
    if (current.trim()) {
      sentences.push(current.trim());
    }

    return sentences;
  }

  /**
   * Check if character is an opening quote
   */
  private isOpeningQuote(char: string): boolean {
    // " (straight), " (left curly), « (guillemet), ' (straight single), „ (low-9)
    return ['"', '\u201C', '\u00AB', "'", '\u201E'].includes(char);
  }

  /**
   * Check if character is a closing quote matching the opening
   */
  private isClosingQuote(char: string, openQuote: string): boolean {
    const pairs: Record<string, string> = {
      '"': '"',             // straight -> straight
      '\u201C': '\u201D',   // " -> " (curly)
      '\u00AB': '\u00BB',   // « -> »
      "'": "'",             // straight single
      '\u201E': '\u201D',   // „ -> " (German/Russian)
    };
    return char === pairs[openQuote] || (char === '"' && openQuote === '"');
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
