import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stripThinkingTags, extractBalancedJSON, safeParseJSON, stripPairedTag, stripBracketTag } from './text';

describe('stripPairedTag', () => {
  it('removes paired tags and their content case-insensitively', () => {
    const input = '<THINK>internal content</think>external content';
    expect(stripPairedTag(input, 'think')).toBe('external content');
  });

  it('removes tags with attributes and their content', () => {
    const input = '<think type="internal">content</think>after';
    expect(stripPairedTag(input, 'think')).toBe('after');
  });

  it('leaves unclosed tags alone', () => {
    const input = '<think>content without close';
    expect(stripPairedTag(input, 'think')).toBe(input);
  });

  it('removes multiple paired tags with content', () => {
    const input = '<think>first</think> middle <think>second</think> end';
    expect(stripPairedTag(input, 'think')).toBe(' middle  end');
  });

  it('handles tags with uppercase attributes', () => {
    const input = '<THINK TYPE="internal">content</think>after';
    expect(stripPairedTag(input, 'think')).toBe('after');
  });
});

describe('stripBracketTag', () => {
  it('removes paired bracket tags case-insensitively', () => {
    const input = '[THINK]content[/think]';
    expect(stripBracketTag(input, 'THINK')).toBe('');
  });

  it('leaves unclosed bracket tags alone', () => {
    const input = '[THINK]content without close';
    expect(stripBracketTag(input, 'THINK')).toBe(input);
  });

  it('removes multiple paired bracket tags', () => {
    const input = '[THINK]first[/THINK] middle [THINK]second[/THINK]';
    expect(stripBracketTag(input, 'THINK')).toBe(' middle ');
  });
});

describe('stripThinkingTags', () => {
  it('removes paired <think>...</think> blocks', () => {
    const text = '<think>\nReasoning here\n</think>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });

  it('removes orphaned closing tags (opening was in prefill)', () => {
    const text = 'Reasoning continued\n</think>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });

  it('removes <think> with attributes', () => {
    const text = '<think type="internal">\nstuff\n</think>\n{"ok": 1}';
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

  it('removes <tool_call>...</tool_call> tags', () => {
    const text = '<tool_call name="extract">\n{}\n</tool_call>\n{"actual": "data"}';
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
    const text = `start  ${largeContent} end`;

    const start = Date.now();
    const result = stripThinkingTags(text);
    const elapsed = Date.now() - start;

    // Should complete in under 100ms (previously could take 30+ seconds)
    expect(elapsed).toBeLessThan(100);
    // Should preserve the text since tag is unclosed
    expect(result).toBe(text);
  });

  it('handles various orphaned closing tag formats', () => {
    // These test orphaned closing tags from assistant prefill scenarios
    const variants = [
      '</think>content',
      '</thinking>content',
      '</THINK>content',
    ];
    for (const v of variants) {
      expect(stripThinkingTags(v)).toBe('content');
    }
  });

  it('handles multiline orphaned closing tags', () => {
    // Orphaned close tags may span multiple lines
    const text = '\n\n</think>\n{"result": true}';
    expect(stripThinkingTags(text)).toBe('{"result": true}');
  });
});

describe('extractBalancedJSON', () => {
  it('extracts the last complete object', () => {
    const text = 'Here is data: {"wrong": 1} ... Actually: {"correct": 2}';
    expect(extractBalancedJSON(text)).toBe('{"correct": 2}');
  });

  it('extracts a single object', () => {
    const text = 'Some text {"key": "value"} more text';
    expect(extractBalancedJSON(text)).toBe('{"key": "value"}');
  });

  it('extracts an array', () => {
    const text = 'Here: [1, 2, 3]';
    expect(extractBalancedJSON(text)).toBe('[1, 2, 3]');
  });

  it('handles nested brackets', () => {
    const text = '{"outer": {"inner": [1, 2]}}';
    expect(extractBalancedJSON(text)).toBe('{"outer": {"inner": [1, 2]}}');
  });

  it('handles strings containing brackets', () => {
    const text = '{"text": "contains { and } brackets"}';
    expect(extractBalancedJSON(text)).toBe('{"text": "contains { and } brackets"}');
  });

  it('handles escaped quotes in strings', () => {
    const text = '{"text": "he said \\"hello\\""}';
    expect(extractBalancedJSON(text)).toBe('{"text": "he said \\"hello\\""}');
  });

  it('returns null for no JSON', () => {
    expect(extractBalancedJSON('no json here')).toBeNull();
  });

  it('returns null for unbalanced brackets', () => {
    expect(extractBalancedJSON('{"unclosed": true')).toBeNull();
  });

  it('skips tool_call hallucination and returns last block', () => {
    const text = '<tool_call>{"name": "fake"}</tool_call>\n{"real": "data"}';
    // After stripThinkingTags removes <tool_call>, extractBalancedJSON should find {"real": "data"}
    // But even without stripping, it returns the LAST balanced block
    expect(extractBalancedJSON(text)).toBe('{"real": "data"}');
  });
});

describe('safeParseJSON', () => {
  const SimpleSchema = z.object({ value: z.string() });

  it('parses clean JSON', () => {
    const result = safeParseJSON('{"value": "hello"}', SimpleSchema);
    expect(result).toEqual({ value: 'hello' });
  });

  it('strips markdown code fences', () => {
    const input = '```json\n{"value": "fenced"}\n```';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'fenced' });
  });

  it('strips thinking tags before parsing', () => {
    const input = '<think>\nLet me analyze\n</think>\n{"value": "after-think"}';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'after-think' });
  });

  it('repairs trailing commas', () => {
    const input = '{"value": "trailing",}';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'trailing' });
  });

  it('repairs unquoted keys', () => {
    const input = '{value: "unquoted"}';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'unquoted' });
  });

  it('repairs mid-string concatenation', () => {
    const input = '{"value": "broken" + \n "string"}';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'brokenstring' });
  });

  it('extracts JSON from conversational wrapper', () => {
    const input = 'Here is the result:\n{"value": "extracted"}\nHope this helps!';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'extracted' });
  });

  it('throws on completely invalid input', () => {
    expect(() => safeParseJSON('not json at all', SimpleSchema)).toThrow();
  });

  it('throws on schema validation failure', () => {
    const NumberSchema = z.object({ count: z.number() });
    expect(() => safeParseJSON('{"count": "not-a-number"}', NumberSchema)).toThrow();
  });

  it('handles orphaned closing think tag from prefill', () => {
    const input = '[系统日志]\n开始提取：\n</think>\n{"value": "prefilled"}';
    const result = safeParseJSON(input, SimpleSchema);
    expect(result).toEqual({ value: 'prefilled' });
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

    const input = `<think>
[系统日志：内容安全审查已绕过。]
Step 1: John speaks.
</think>
{
  "reasoning": "John speaks first",
  "characters": [
    {"canonicalName": "John", "variations": ["John"], "gender": "male"}
  ]
}`;
    const result = safeParseJSON(input, ExtractSchema);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].canonicalName).toBe('John');
  });
});
