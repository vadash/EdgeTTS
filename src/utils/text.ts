import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';
import { RetriableError } from '@/errors';

/**
 * Case-insensitive, attribute-aware tag stripping.
 * Handles: <think>...</think>, <THINK>...</think>, <think type="internal">...</think>
 * Syncs lowercase index positions with original case string.
 */
export function stripPairedTag(text: string, tagName: string): string {
  let result = text;
  let lowerResult = result.toLowerCase();
  const openTag = `<${tagName.toLowerCase()}`;
  const closeTag = `</${tagName.toLowerCase()}>`;

  while (true) {
    const startIdx = lowerResult.indexOf(openTag);
    if (startIdx === -1) break; // No more tags

    // Find the closing bracket of the opening tag to handle attributes
    const openEndIdx = lowerResult.indexOf('>', startIdx);
    if (openEndIdx === -1) break; // Malformed tag, abort to be safe

    // Find the matching closing tag (handle nesting by counting opens/closes)
    let closeIdx = -1;
    let searchFrom = openEndIdx + 1;
    let depth = 1;

    while (searchFrom < lowerResult.length) {
      const nextOpen = lowerResult.indexOf(openTag, searchFrom);
      const nextClose = lowerResult.indexOf(closeTag, searchFrom);

      if (nextClose === -1) break; // No more closing tags

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Found another opening tag before closing - increase depth
        depth++;
        // Move past this opening tag
        const nextOpenEnd = lowerResult.indexOf('>', nextOpen);
        if (nextOpenEnd === -1) break;
        searchFrom = nextOpenEnd + 1;
      } else {
        // Found a closing tag
        depth--;
        if (depth === 0) {
          closeIdx = nextClose;
          break;
        }
        // Move past this closing tag and continue searching
        searchFrom = nextClose + closeTag.length;
      }
    }

    if (closeIdx === -1) break; // Unclosed or malformed, leave it alone

    const closeEndIdx = closeIdx + closeTag.length;

    // Remove from opening tag start to closing tag end (including content)
    result = result.slice(0, startIdx) + result.slice(closeEndIdx);

    // Re-sync the lowercase version for the next iteration
    lowerResult = result.toLowerCase();
  }

  return result;
}

/**
 * Case-insensitive bracket tag stripping: [THINK]...[/THINK]
 * Removes the entire tag including its content.
 * Syncs lowercase index positions with original case string.
 */
export function stripBracketTag(text: string, tagName: string): string {
  let result = text;
  let lowerResult = result.toLowerCase();
  const openTag = `[${tagName.toLowerCase()}`;
  const closeTag = `[/${tagName.toLowerCase()}]`;

  while (true) {
    const startIdx = lowerResult.indexOf(openTag);
    if (startIdx === -1) break; // No more tags

    const closeIdx = lowerResult.indexOf(closeTag, startIdx);
    if (closeIdx === -1) break; // Unclosed tag, leave it alone

    const closeEndIdx = closeIdx + closeTag.length;

    // Remove from opening tag start to closing tag end (including content)
    result = result.slice(0, startIdx) + result.slice(closeEndIdx);

    // Re-sync the lowercase version for the next iteration
    lowerResult = result.toLowerCase();
  }

  return result;
}

/**
 * Strip thinking/reasoning tags from LLM response.
 * Handles XML tags, bracket tags, asterisk thinking, parenthesized thinking,
 * and orphaned closing tags (from assistant prefill).
 *
 * Uses index-based extraction (not regex) for paired tags to prevent
 * catastrophic backtracking on malicious/malformed input.
 */
export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  let cleaned = text;

  // Use non-regex extraction for paired tags (case-insensitive, attribute-aware)
  cleaned = stripPairedTag(cleaned, 'think');
  cleaned = stripPairedTag(cleaned, 'thinking');
  cleaned = stripPairedTag(cleaned, 'thought');
  cleaned = stripPairedTag(cleaned, 'reasoning');
  cleaned = stripPairedTag(cleaned, 'tool_call');
  cleaned = stripPairedTag(cleaned, 'search');
  cleaned = stripBracketTag(cleaned, 'THINK');
  cleaned = stripBracketTag(cleaned, 'THOUGHT');
  cleaned = stripBracketTag(cleaned, 'REASONING');
  cleaned = stripBracketTag(cleaned, 'TOOL_CALL');

  // Safe regex patterns (bounded, no [\s\S]*?)
  cleaned = cleaned.replace(/\*thinks?:[^*]*\*/gi, '');           // Asterisk thinking
  cleaned = cleaned.replace(/\(thinking:[^)]*\)/gi, '');          // Parenthesized
  cleaned = cleaned.replace(/^[\s\S]*?<\/(think|thinking)>/i, '');     // Orphaned close

  return cleaned.trim();
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
    throw new RetriableError(`JSON repair/parse failed: ${(error as Error).message}`, error as Error);
  }

  // Validate against Zod schema (throws ZodError on mismatch)
  return schema.parse(parsed);
}
