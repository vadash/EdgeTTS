# Hard Cut Fallback for TextBlockSplitter

**Status:** Proposed
**Created:** 2025-04-16
**Component:** `src/services/TextBlockSplitter.ts`

## Problem Statement

`TextBlockSplitter.splitParagraphIntoSentences()` relies on punctuation (`.`, `!`, `?`) and quote-aware logic to split paragraphs. When text has no sentence-ending punctuation, or is entirely inside quotes, it returns the full string intact — potentially 15,000+ characters.

This creates two issues:

1. **Index desync:** The LLM processes N sentences, but TTS suddenly has N+M chunks. The `fileNames` chapter boundaries must be remapped.
2. **Token waste:** A single 15,000-character block consumes massive context window and risks hitting token limits.

## Solution

Add a hard-cut fallback to `splitIntoParagraphs()` that guarantees no paragraph exceeds 3000 characters, regardless of formatting. Use this fix to also remove the now-redundant `splitLongSentence()` method.

## Architecture

### Current Flow

```
splitIntoParagraphs(text)
  ├─ split by \n
  └─ if paragraph > 3000 chars
      └─ splitParagraphIntoSentences(paragraph)
          └─ returns sentences (MAY return >3000 chars if no punctuation)

splitIntoBlocks(sentences, maxTokens)
  └─ if sentence > maxTokens
      └─ splitLongSentence(sentence, maxTokens)  ← Too late!
```

### Proposed Flow

```
splitIntoParagraphs(text)
  ├─ split by \n
  ├─ if paragraph > 3000 chars
  │   └─ splitParagraphIntoSentences(paragraph)
  │       └─ returns sentences
  └─ forceSplitLongParagraphs(sentences)  ← NEW GUARD
      └─ guarantees all returned strings < 3000 chars

splitIntoBlocks(sentences, maxTokens)
  └─ splitLongSentence() REMOVED (now dead code)
```

## Implementation

### New Method: `forceSplitLongParagraphs()`

```typescript
/**
 * Force-split paragraphs that exceeded 3000 chars after sentence splitting.
 * This catches edge cases where splitParagraphIntoSentences failed due to
 * missing punctuation or text entirely inside quotes.
 *
 * Splits at last space or comma before MAX_PARAGRAPH_CHARS (3000).
 * If no space/comma found, hard-cuts at exactly MAX_PARAGRAPH_CHARS.
 */
private forceSplitLongParagraphs(paragraphs: string[]): string[] {
  const MAX_PARAGRAPH_CHARS = 3000;
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_PARAGRAPH_CHARS) {
      result.push(paragraph);
      continue;
    }

    let remaining = paragraph;
    while (remaining.length > MAX_PARAGRAPH_CHARS) {
      // Find last space or comma before limit
      let splitPoint = MAX_PARAGRAPH_CHARS;
      const lastSpace = remaining.lastIndexOf(' ', MAX_PARAGRAPH_CHARS);
      const lastComma = remaining.lastIndexOf(',', MAX_PARAGRAPH_CHARS);
      const bestSplit = Math.max(lastSpace, lastComma);

      if (bestSplit > MAX_PARAGRAPH_CHARS / 2) {
        splitPoint = bestSplit + 1; // +1 to include the separator
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
```

### Modified Method: `splitIntoParagraphs()`

```typescript
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

  // NEW: Force-split any remaining oversized paragraphs
  return this.forceSplitLongParagraphs(paragraphs);
}
```

### Removed Method: `splitLongSentence()`

Delete lines ~288-311. The method is no longer called after the fix.

## Data Flow

1. **Input:** Raw book text
2. **`splitIntoParagraphs()`:** Splits by `\n`, delegates >3000-char paragraphs to `splitParagraphIntoSentences()`
3. **`forceSplitLongParagraphs()`:** Post-processes all paragraphs, force-splits any still >3000 chars
4. **Output:** Array of strings, all ≤3000 chars
5. **Downstream:** `splitIntoBlocks()` receives clean input, no longer needs oversized-sentence handling

## Error Handling

- **Empty strings:** `trim()` calls ensure no empty strings enter the pipeline
- **No separators found:** Falls back to hard cut at exactly 3000 chars (better than 15,000 chars)
- **Pronounceability:** The existing `isPronounceable()` filter in `splitParagraphIntoSentences()` already ensures output has valid content

## Testing Strategy

### Unit Tests

Add tests for `forceSplitLongParagraphs()`:

```typescript
describe('forceSplitLongParagraphs', () => {
  it('should not split paragraphs under 3000 chars', () => {
    const input = ['Short paragraph.', 'Another short one.'];
    expect(splitter.forceSplitLongParagraphs(input)).toEqual(input);
  });

  it('should split at last space before 3000 chars', () => {
    const long = 'a '.repeat(1500) + 'word' + ' b'.repeat(1500);
    const result = splitter.forceSplitLongParagraphs([long]);
    expect(result[0].length).toBeLessThanOrEqual(3000);
    expect(result.every(s => !s.endsWith(' '))).toBe(true);
  });

  it('should split at comma if better than space', () => {
    const long = 'a,'.repeat(1500) + 'word' + ',b'.repeat(1500);
    const result = splitter.forceSplitLongParagraphs([long]);
    expect(result[0].length).toBeLessThanOrEqual(3000);
  });

  it('should hard cut if no space or comma found', () => {
    const long = 'a'.repeat(5000);
    const result = splitter.forceSplitLongParagraphs([long]);
    expect(result[0].length).toBe(3000);
    expect(result.length).toBe(2);
  });

  it('should handle multiple paragraphs', () => {
    const input = [
      'short',
      'a'.repeat(4000),
      'b'.repeat(4000),
      'another short'
    ];
    const result = splitter.forceSplitLongParagraphs(input);
    expect(result.every(s => s.length <= 3000)).toBe(true);
  });
});
```

### Integration Tests

Test the full flow with edge case inputs:

```typescript
describe('splitIntoParagraphs integration', () => {
  it('should handle 15000-char paragraph with no punctuation', () => {
    const text = 'a'.repeat(15000);
    const result = splitter.splitIntoParagraphs(text);
    expect(result.every(s => s.length <= 3000)).toBe(true);
    expect(result.length).toBe(5);
  });

  it('should handle paragraph entirely inside quotes', () => {
    const text = '"' + 'a'.repeat(15000) + '"';
    const result = splitter.splitIntoParagraphs(text);
    expect(result.every(s => s.length <= 3000)).toBe(true);
  });
});
```

## Trade-offs

### Pros
- ✅ Fixes index desync — 1-to-1 mapping preserved across entire pipeline
- ✅ Reduces LLM token waste — no more 15,000-char "sentences"
- ✅ Removes dead code (`splitLongSentence`)
- ✅ Single-file change, low risk

### Cons
- ⚠️ Hard cuts at comma/space may break words in edge cases (but better than 15,000-char blocks)
- ⚠️ Adds one method to maintain

## Rollout Plan

1. Add `forceSplitLongParagraphs()` method
2. Modify `splitIntoParagraphs()` to call it
3. Remove `splitLongSentence()` method
4. Add unit tests
5. Run existing test suite to verify no regressions
6. Manual test with known problem books (15,000-char paragraphs, no punctuation)
