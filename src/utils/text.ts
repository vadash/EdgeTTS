import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';

/**
 * Strip thinking/reasoning tags from LLM response.
 * Handles XML tags, bracket tags, asterisk thinking, parenthesized thinking,
 * and orphaned closing tags (from assistant prefill).
 */
export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  return (
    text
      // Paired XML tags: <think>...</think>, <tool_call name="x">...</tool_call>, etc.
      .replace(
        /<(think|thinking|thought|reasoning|reflection|tool_call|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
        '',
      )
      // Paired bracket tags: [THINK]...[/THINK], [TOOL_CALL]...[/TOOL_CALL]
      .replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
      // Asterisk-wrapped thinking: *thinks: ...*
      .replace(/\*thinks?:[\s\S]*?\*/gi, '')
      // Parenthesized thinking: (thinking: ...)
      .replace(/\(thinking:[\s\S]*?\)/gi, '')
      // Orphaned closing tags (opening tag was in assistant prefill)
      .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|tool_call|search)>\s*/i, '')
      .trim()
  );
}

/**
 * Extract the LAST balanced JSON object or array from a string.
 * Scans all balanced blocks and returns the final one found.
 *
 * Why "Last"? LLMs output reasoning and hallucinated <tool_call> snippets
 * BEFORE the actual payload. The real JSON is always the last complete block.
 */
export function extractBalancedJSON(str: string): string | null {
  let lastMatch: string | null = null;
  let searchFrom = 0;

  while (searchFrom < str.length) {
    // Find next opening bracket
    let startIdx = -1;
    for (let i = searchFrom; i < str.length; i++) {
      if (str[i] === '{' || str[i] === '[') {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) break;

    const open = str[startIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let endIdx = -1;

    for (let i = startIdx; i < str.length; i++) {
      const ch = str[i];

      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        isEscaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx !== -1) {
      lastMatch = str.slice(startIdx, endIdx + 1);
      searchFrom = endIdx + 1;
    } else {
      searchFrom = startIdx + 1;
    }
  }

  return lastMatch;
}

/**
 * Safely parse LLM output as JSON, applying multi-stage repair:
 * 1. Strip thinking/reasoning tags
 * 2. Strip markdown code fences
 * 3. Extract last balanced JSON block
 * 4. Sanitize LLM syntax hallucinations (string concatenation, dangling plus)
 * 5. Pad truncated outputs (odd quote count)
 * 6. jsonrepair for structural issues
 * 7. Zod schema validation
 *
 * Throws on failure (designed for use with withRetry + RetriableError).
 */
export function safeParseJSON<T>(input: string, schema: z.ZodType<T>): T {
  let cleaned = stripThinkingTags(input);

  // Strip markdown code fences
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Extract the LAST balanced block to dodge tool_call hallucinations
  const extracted = extractBalancedJSON(cleaned);
  if (extracted) {
    cleaned = extracted;
  }

  // --- LLM SYNTAX HALLUCINATION SANITIZER ---
  // Negative lookbehinds (?<!\\) ensure we don't remove escaped quotes in valid strings.
  // Matches both standard (+) and full-width (＋) Chinese plus signs.

  // 1. Mid-string concatenation: "text" +\n "more" -> "textmore"
  cleaned = cleaned.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

  // 2. Dangling plus before punctuation: "text" + , -> "text" ,
  cleaned = cleaned.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*([,}\]])/g, '$1$2');

  // 3. Dangling plus at EOF: "text" + \n -> "text"
  cleaned = cleaned.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*$/g, '$1');

  // 4. Pad truncated outputs: odd number of unescaped " means an unclosed string
  const withoutEscapedQuotes = cleaned.replace(/\\"/g, '');
  const unescapedQuoteCount = (withoutEscapedQuotes.match(/"/g) || []).length;
  if (unescapedQuoteCount % 2 !== 0) {
    cleaned = cleaned + '"]}]}'; // Pad brackets, jsonrepair will untangle
  }

  // Pass sanitized string to repair library
  let parsed: unknown;
  try {
    const repaired = jsonrepair(cleaned);
    parsed = JSON.parse(repaired);
  } catch (error) {
    throw new Error(`JSON repair/parse failed: ${(error as Error).message}`);
  }

  // Validate against Zod schema (throws ZodError on mismatch)
  return schema.parse(parsed);
}
