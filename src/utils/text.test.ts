import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  stripThinkingTags,
  extractJsonBlocks,
  safeParseJSON,
  normalizeText,
  stripMarkdownFences,
  scrubConcatenation
} from './text';

describe('normalizeText', () => {
  it('replaces smart quotes with standard quotes', () => {
    expect(normalizeText('"hello"')).toBe('"hello"');
    expect(normalizeText("'world'")).toBe("'world'");
  });

  it('strips control characters except newline/tab', () => {
    expect(normalizeText('hello\x00world')).toBe('helloworld');
    expect(normalizeText('hello\nworld')).toBe('hello\nworld');
    expect(normalizeText('hello\tworld')).toBe('hello\tworld');
  });

  it('returns non-strings as-is', () => {
    expect(normalizeText(null as any)).toBe(null);
    expect(normalizeText(undefined as any)).toBe(undefined);
  });
});

describe('extractJsonBlocks', () => {
  it('extracts single JSON object', () => {
    const blocks = extractJsonBlocks('text {"a": 1} more');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('{"a": 1}');
    expect(blocks[0].isObject).toBe(true);
  });

  it('extracts multiple blocks and returns all', () => {
    const blocks = extractJsonBlocks('{"a": 1} text [1, 2] more');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('{"a": 1}');
    expect(blocks[1].text).toBe('[1, 2]');
    expect(blocks[1].isObject).toBe(false);
  });

  it('returns empty array for no JSON', () => {
    expect(extractJsonBlocks('no json here')).toEqual([]);
  });
});

describe('stripMarkdownFences', () => {
  it('strips complete fences', () => {
    expect(stripMarkdownFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripMarkdownFences('~~~\n{"a": 1}\n~~~')).toBe('{"a": 1}');
  });

  it('strips orphan fences', () => {
    expect(stripMarkdownFences('```json\n{"a": 1}')).toBe('{"a": 1}');
    expect(stripMarkdownFences('{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('returns text as-is if no fences', () => {
    expect(stripMarkdownFences('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('scrubConcatenation', () => {
  it('removes mid-string concatenation', () => {
    expect(scrubConcatenation('"hello" + "world"')).toBe('"helloworld"');
  });

  it('handles full-width plus', () => {
    expect(scrubConcatenation('"hello" ＋ "world"')).toBe('"helloworld"');
  });

  it('removes dangling plus before punctuation', () => {
    expect(scrubConcatenation('"text" + ,')).toBe('"text",');
  });
});

describe('stripThinkingTags', () => {
  it('removes paired </think>...</think> blocks', () => {
    const text = String.raw`<thinking>
Reasoning here
</thinking>
{"result": true}`;
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });

  it('removes orphaned closing tags (opening was in prefill)', () => {
    const text = 'Reasoning continued\n</thinking>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });

  it('removes </think> with attributes', () => {
    const text = '<think type="internal">\nstuff\n</thinking>\n{"ok": 1}';
    expect(stripThinkingTags(text)).toBe('{"ok": 1}');
  });

  it('removes bracket-style [THINK]...[/THINK]', () => {
    const text = '[THINK]Some reasoning[/THINK]\n{"data": 1}';
    expect(stripThinkingTags(text)).toBe('{"data": 1}');
  });

  it('removes asterisk thinking *thinks: ...*', () => {
    const text = '*thinks: I should extract the data*\n{"value": "ok"}';
    expect(stripThinkingTags(text)).toBe('{"value": "ok"}');
  });

  it('removes parenthesized (thinking: ...)', () => {
    const text = '(thinking: let me analyze this)\n{"value": "ok"}';
    expect(stripThinkingTags(text)).toBe('{"value": "ok"}');
  });

  it('removes <reasoning> tags', () => {
    const text = '<reasoning>\nStep 1: analyze\n</reasoning>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });

  it('removes <tool_call>...</think> tags', () => {
    const text = String.raw`<tool_call name="extract">
{}
</tool_call>
{"actual": "data"}`;
    expect(stripThinkingTags(text)).toBe('{"actual": "data"}');
  });

  it('returns non-string input unchanged', () => {
    expect(stripThinkingTags(42 as any)).toBe(42);
    expect(stripThinkingTags(null as any)).toBe(null);
  });

  it('handles text with no thinking tags', () => {
    const text = '{"clean": "json"}';
    expect(stripThinkingTags(text)).toBe('{"clean": "json"}');
  });

  it('prevents catastrophic backtracking on large unclosed tags', () => {
    // This test verifies that index-based extraction prevents regex DoS
    // Previous regex-based implementation could hang on 50KB+ unclosed tags
    const largeContent = 'x'.repeat(50000);
    // This is a TRULY unclosed tag (no closing </think>), so it should be preserved
    const text = String.raw`start <think>
${largeContent}
 end`;

    const start = Date.now();
    const result = stripThinkingTags(text);
    const elapsed = Date.now() - start;

    // Should complete in under 100ms (previously could take 30+ seconds)
    expect(elapsed).toBeLessThan(100);
    // Unclosed tags are NOT removed by stripThinkingTags (only paired tags are)
    expect(result).toBe(text);
  });

  it('handles various orphaned closing tag formats', () => {
    // These test orphaned closing tags from assistant prefill scenarios
    const variants = [
      '</thinking>content',
      '</thinking>content',
      '</THINK>content',
    ];
    for (const v of variants) {
      expect(stripThinkingTags(v)).toBe('content');
    }
  });

  it('handles multiline orphaned closing tags', () => {
    // Orphaned close tags may span multiple lines
    const text = '\n\n</thinking>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });
});

describe('safeParseJSON', () => {
  const SimpleSchema = z.object({ value: z.string() });
  const NumberSchema = z.object({ count: z.number() });

  it('parses valid JSON', () => {
    const result = safeParseJSON('{"value": "hello"}', { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('strips thinking tags before parsing', () => {
    const input = `<thinking>let me think</thinking>{"value": "hello"}`;
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('strips markdown fences before parsing', () => {
    const input = '```json\n{"value": "hello"}\n```';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('handles string concatenation hallucinations at Tier 4', () => {
    const input = '{"value": "hello" + "world"}';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('helloworld');
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'some text {"value": "hello"} more text';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('returns error result for invalid JSON', () => {
    const result = safeParseJSON('not json at all', { schema: SimpleSchema });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns error result for schema mismatch', () => {
    const result = safeParseJSON('{"count": "not-a-number"}', { schema: NumberSchema });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('handles orphaned closing tags', () => {
    const input = '</thinking>{"value": "hello"}';
    const result = safeParseJSON(input, { schema: SimpleSchema });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe('hello');
  });

  it('works without schema (returns unknown)', () => {
    const result = safeParseJSON('{"any": "data"}');
    expect(result.success).toBe(true);
    expect((result.data as any).any).toBe('data');
  });

  it('handles the full ExtractSchema shape', () => {
    const ExtractSchema = z.object({
      reasoning: z.string().nullable().default(null),
      characters: z.array(z.object({
        canonicalName: z.string().min(1),
        variations: z.array(z.string().min(1)),
        gender: z.enum(['male', 'female', 'unknown']),
      })).min(1),
    });

    const input = String.raw`<thinking>
[System Log: Content safety check bypassed.]
Step 1: John speaks.
</thinking>
{
  "reasoning": "John speaks first",
  "characters": [
    {"canonicalName": "John", "variations": ["John"], "gender": "male"}
  ]
}`;
    const result = safeParseJSON(input, { schema: ExtractSchema });
    expect(result.success).toBe(true);
    expect(result.data?.characters).toHaveLength(1);
    expect(result.data?.characters[0].canonicalName).toBe('John');
  });
});
