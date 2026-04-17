# SSML XML Escaping Design

**Status:** Proposed
**Date:** 2026-04-16
**Author:** Design Review

## Problem Statement

Chunks containing XML special characters (`<`, `>`, `&`, `"`, `'`) are permanently failing during TTS conversion. The Edge TTS server rejects malformed SSML as invalid XML, causing WebSocket closure. The retry mechanism blindly resends the same malformed payload 5 times before marking the chunk as permanently failed.

**Root Cause:** The `makeSSML()` method in `ReusableEdgeTTSService.ts` concatenates raw text directly into an XML envelope without escaping special characters.

### Example Failure Cases

| Input Text | Current SSML Output | Result |
|------------|---------------------|--------|
| `"5 < 10"` | `<prosody>5 < 10</prosody>` | Malformed XML |
| `"AT&T"` | `<prosody>AT&T</prosody>` | Malformed XML |
| `"He said 'hi'"` | `<prosody>He said 'hi'</prosody>` | Malformed XML |

## Solution

Add XML entity escaping at the transport boundary in `makeSSML()`. This follows the principle of formatting data exactly where it leaves the application boundary.

## Design

### Architecture

```
Raw Text (book content)
  ↓
sanitizeText() - TTS pronunciation cleanup
  ↓                (markdown removal, HTML stripping, character normalization)
  ↓
makeSSML() - NEW: XML entity escaping
  ↓
SSML envelope with escaped text
  ↓
WebSocket send to Edge TTS
```

### Implementation

**File:** `src/services/ReusableEdgeTTSService.ts`
**Method:** `makeSSML()` (lines 373-380)

**Change:**

```typescript
private makeSSML(text: string, config: TTSConfig): string {
  // Escape XML special characters before inserting into SSML
  // IMPORTANT: Must replace '&' first to avoid double-escaping
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\n" +
    `<voice name='${config.voice}'><prosody pitch='${config.pitch}' rate='${config.rate}' volume='${config.volume}'>\n` +
    escaped +
    '\n</prosody></voice></speak>'
  );
}
```

### Why This Approach

1. **Transport Boundary Escaping:** Text is escaped at the exact point it enters the XML envelope, preserving original text in UI, logs, and state.
2. **DRY:** Single point of escaping in the one function that actually builds XML.
3. **TTS-Friendly:** Edge TTS correctly pronounces `&lt;` as "less than" without altering the book's text.
4. **International-Safe:** Does not affect Unicode characters (Cyrillic, Chinese, etc.).
5. **Simple:** 5 lines of code, no new dependencies or abstractions.

### Error Handling Impact

**Before:**
- Malformed SSML → WebSocket closure → `RetriableError` → 5 retries → Permanent fail

**After:**
- All text is XML-safe → No malformed SSML → No permanent failures from XML characters

### Edge Cases

| Case | Behavior | Safe? |
|------|----------|-------|
| Normal text | Passes through unchanged | ✓ |
| XML special chars | Escaped to entities | ✓ |
| Already-escaped (`&amp;`) | Becomes `&amp;amp;` | ✓ (redundant but valid) |
| Empty string | No change | ✓ |
| International (中文, Русский) | Passes through unchanged | ✓ |
| Very long chunks | Regex performance acceptable | ✓ |

## Testing Strategy

### Unit Tests

**File:** `src/services/__tests__/ReusableEdgeTTSService.test.ts`

**Test cases:**

1. **Escape all 5 XML special characters**
   ```typescript
   expect(ssml).toContain('&lt;');
   expect(ssml).toContain('&gt;');
   expect(ssml).toContain('&amp;');
   expect(ssml).toContain('&quot;');
   expect(ssml).toContain('&apos;');
   ```

2. **Verify escaping order** (`&` must be first)
   ```typescript
   // Input: "A & B < C"
   // Should NOT become: "A &amp; B &lt; C" where &amp; gets re-escaped
   ```

3. **Normal text passes through unchanged**
   ```typescript
   const normalText = "Hello world";
   expect(ssml).toContain('>Hello world<');
   ```

4. **Already-escaped text doesn't break**
   ```typescript
   const escapedText = "&lt;tag&gt;";
   // Should become: &amp;lt;tag&amp;gt;
   // Still valid XML, just redundant
   ```

5. **International characters pass through**
   ```typescript
   expect(ssml).toContain('Привет');
   expect(ssml).toContain('你好');
   ```

### Integration Test

**Scenario:** Send chunks with known problematic characters through the full pipeline.

**Test data:**
- `"5 < 10 and 20 > 15"`
- `"AT&T is a company"`
- `"O'Connor's book"`
- `'<script>alert("xss")</script>'` (after sanitizeText HTML removal)

**Expected:** All chunks succeed without WebSocket closure or permanent failure.

## Rollout Plan

1. Add XML escaping to `makeSSML()`
2. Add unit tests
3. Run integration test with problematic characters
4. Monitor `logs/tts_fail*.json` for XML-related failures
5. If clean, close issue

## Alternatives Considered

### Approach A: Escaping in `sanitizeText()`

**Rejected:** `sanitizeText()` is for TTS pronunciation optimization (markdown removal, character normalization). XML escaping is a transport concern and should be handled separately.

### Approach B: Separate `SSMLEscaper` utility class

**Rejected:** Overkill for 5 character replacements. Can be extracted later if more SSML utilities are needed (YAGNI).

### Approach C: Allowlist-only characters

**Rejected:** Would destroy international text, names with apostrophes, em-dashes, and other valid book content.

## References

- Issue context: `tmp/rpz.txt`
- Current SSML generation: `src/services/ReusableEdgeTTSService.ts:373-380`
- Text sanitization: `src/services/ConversionOrchestrator.ts:126-167`
- Retry mechanism: `src/services/TTSWorkerPool.ts:346-404`
