import { defaultConfig } from '@/config';
import type { TextBlock } from '@/state/types';

/**
 * Intl.Segmenter instances are expensive to construct, so they are
 * cached per locale. An invalid BCP-47 tag throws at construction, and
 * the fallback then uses 'en'.
 */
const segmenterCache = new Map<string, Intl.Segmenter>();
function getSegmenter(locale: string): Intl.Segmenter {
  let seg = segmenterCache.get(locale);
  if (!seg) {
    try {
      seg = new Intl.Segmenter(locale, { granularity: 'sentence' });
    } catch {
      seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
    segmenterCache.set(locale, seg);
  }
  return seg;
}

/**
 * Each input line is processed separately, so a sentence never spans
 * two lines.
 */
export class TextBlockSplitter {
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Returns sentences, one per entry. Every line is split on sentence
   * boundaries to keep units small for the LLM passes and to prevent TTS
   * timeouts.
   */
  splitIntoParagraphs(text: string, language: string = 'en'): string[] {
    const paragraphs: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const sentences = this.splitParagraphIntoSentences(trimmed, language);
      paragraphs.push(...sentences);
    }

    // Safety net: no sentence may exceed 2000 chars.
    const split = this.splitLongSentences(paragraphs);

    return this.forceSplitLongParagraphs(split);
  }

  /**
   * Splits a paragraph into sentences with Intl.Segmenter. Abbreviations
   * are handled natively per locale, so no hand-rolled list is needed
   * (docs/adr/0001-native-sentence-segmenter-for-split.md). Quoted
   * speech stays in one segment; over-long quotes are broken up later by
   * splitLongSentences.
   */
  private splitParagraphIntoSentences(paragraph: string, locale: string): string[] {
    const text = paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    const sentences: string[] = [];
    for (const { segment } of getSegmenter(locale).segment(text)) {
      const trimmed = segment.trim();
      if (trimmed && this.isPronounceable(trimmed)) {
        sentences.push(trimmed);
      }
    }
    return sentences;
  }

  /**
   * Splits over-long sentences on structural delimiters first, then on
   * commas. Targets stat blocks and long game-mechanics text that lacks
   * sentence-ending punctuation.
   */
  private splitLongSentences(sentences: string[]): string[] {
    const MAX_SENTENCE_CHARS = 300;
    // ASCII art separators: long runs of ¯ or _
    const SEPARATOR_RE = /[¯_]{5,}/g;
    const result: string[] = [];

    for (const sentence of sentences) {
      if (sentence.length <= MAX_SENTENCE_CHARS) {
        result.push(sentence);
        continue;
      }

      if (SEPARATOR_RE.test(sentence)) {
        SEPARATOR_RE.lastIndex = 0;
        const parts = sentence
          .split(SEPARATOR_RE)
          .map((p) => p.trim())
          .filter((p) => p && this.isPronounceable(p));
        if (parts.length > 1) {
          // A part can still be over-long, so re-check each one.
          for (const part of parts) {
            if (part.length <= MAX_SENTENCE_CHARS) {
              result.push(part);
            } else {
              result.push(...this.splitOnCommas(part, MAX_SENTENCE_CHARS));
            }
          }
          continue;
        }
        SEPARATOR_RE.lastIndex = 0;
      }

      const commaSplit = this.splitOnCommas(sentence, MAX_SENTENCE_CHARS);
      if (commaSplit.length > 1) {
        result.push(...commaSplit);
        continue;
      }

      // No good split point: keep the sentence whole.
      // forceSplitLongParagraphs handles the over-long case.
      result.push(sentence);
    }

    return result;
  }

  /**
   * Split text on commas, grouping chunks up to maxChars.
   */
  private splitOnCommas(text: string, maxChars: number): string[] {
    const result: string[] = [];
    let current = '';

    for (const segment of text.split(',')) {
      const candidate = current ? `${current},${segment}` : segment;
      if (candidate.length > maxChars && current) {
        const trimmed = current.trim();
        if (trimmed && this.isPronounceable(trimmed)) result.push(trimmed);
        current = segment;
      } else {
        current = candidate;
      }
    }

    const trimmed = current.trim();
    if (trimmed && this.isPronounceable(trimmed)) result.push(trimmed);
    return result;
  }

  /**
   * Safety net for over-long sentences that survived all earlier splits.
   * Splits at the last space or comma before the limit; a hard cut is
   * the fallback.
   */
  private forceSplitLongParagraphs(paragraphs: string[]): string[] {
    const MAX_PARAGRAPH_CHARS = 2000;
    const result: string[] = [];

    for (const paragraph of paragraphs) {
      let remaining = paragraph;

      while (remaining.length > MAX_PARAGRAPH_CHARS) {
        const lastSpaceIndex = remaining.lastIndexOf(' ', MAX_PARAGRAPH_CHARS);
        const lastCommaIndex = remaining.lastIndexOf(',', MAX_PARAGRAPH_CHARS);

        // Take the later split point, but keep the head at least
        // MIN_CHUNK_SIZE chars.
        let splitPoint = MAX_PARAGRAPH_CHARS;
        const MIN_CHUNK_SIZE = 500;

        if (lastCommaIndex > MIN_CHUNK_SIZE && lastCommaIndex > lastSpaceIndex) {
          splitPoint = lastCommaIndex + 1;
        } else if (lastSpaceIndex > MIN_CHUNK_SIZE) {
          splitPoint = lastSpaceIndex + 1;
        }

        result.push(remaining.slice(0, splitPoint).trim());
        remaining = remaining.slice(splitPoint).trim();
      }

      if (remaining) {
        result.push(remaining);
      }
    }

    return result;
  }

  private isPronounceable(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
  }

  /**
   * Simplified dialogue-symbol check for narration detection. Kept
   * local: the full speech-symbol logic belongs to the LLM stages, and
   * importing it from there would point the dependency the wrong way.
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

    if (/^[-*_~=]{3,}$/.test(trimmed) || trimmed === '* * *' || trimmed === '<--->') {
      return 1;
    }

    if (trimmed.length < 50 && trimmed.length > 0) {
      if (/^(Chapter|Глава|Book|Prologue|Epilogue|Пролог|Эпилог)\s*\d*\s*$/i.test(trimmed)) {
        return 2;
      }
    }

    if (trimmed.length > 150 && !this.hasDialogueSymbols(trimmed)) {
      return 3;
    }

    return 0;
  }

  /**
   * Prefers semantic scene breaks over arbitrary token-limit cuts.
   */
  splitIntoBlocks(sentences: string[], maxTokens: number): TextBlock[] {
    const blocks: TextBlock[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;
    let sentenceStartIndex = 0;
    let blockIndex = 0;
    const WARNING_THRESHOLD = maxTokens * 0.85;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const tokens = this.estimateTokens(sentence);

      // Semantic breaks are considered only past the warning threshold,
      // near the natural block end.
      if (currentTokens > WARNING_THRESHOLD) {
        const priority = this.getBreakPriority(sentence);

        if (priority === 1) {
          // The divider sentence itself is dropped, and consecutive
          // dividers collapse into one break.
          if (currentBlock.length > 0) {
            blocks.push({
              blockIndex: blockIndex++,
              sentences: currentBlock,
              sentenceStartIndex,
            });
          }
          currentBlock = [];
          currentTokens = 0;
          while (i + 1 < sentences.length && this.getBreakPriority(sentences[i + 1]) === 1) {
            i++;
          }
          sentenceStartIndex = i + 1;
          continue;
        }

        if (priority === 2) {
          // A chapter header closes the block; the header sentence
          // starts the next block.
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
          // Fall through: the header sentence is added to the new block
          // below.
        }

        if (priority === 3) {
          // Long narration stays in the block; the block closes after
          // it.
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
      }

      // Hard cut at the token limit.
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
   * Blocks for the Extract pass, which uses the larger block size.
   */
  createExtractBlocks(text: string, language: string = 'en'): TextBlock[] {
    const paragraphs = this.splitIntoParagraphs(text, language);
    return this.splitIntoBlocks(paragraphs, defaultConfig.llm.extractBlockTokens);
  }

  /**
   * Blocks for the Assign pass, which uses the smaller block size.
   */
  createAssignBlocks(text: string, language: string = 'en'): TextBlock[] {
    const paragraphs = this.splitIntoParagraphs(text, language);
    return this.splitIntoBlocks(paragraphs, defaultConfig.llm.assignBlockTokens);
  }
}

export const textBlockSplitter = new TextBlockSplitter();
