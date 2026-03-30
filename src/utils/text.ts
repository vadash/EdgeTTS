import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';

/**
 * Normalize text by fixing invisible characters and typographical anomalies.
 * - Strips unescaped control characters (\x00-\x1F), preserving \n, \r, \t
 * - Replaces smart/curly quotes with standard quotes
 * - Strips Unicode line/paragraph separators (\u2028, \u2029)
 */
export function normalizeText(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return (
    text
      // Replace smart double quotes
      .replace(/[""]/g, '"')
      // Replace smart single quotes
      .replace(/['']/g, "'")
      // Strip Unicode line/paragraph separators
      .replace(/[\u2028\u2029]/g, '')
      // Strip unescaped control characters (preserve \n \r \t)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  );
}

/**
 * Extract all balanced JSON blocks from a string.
 * Correctly handles strings, escape sequences, and nested structures.
 */
export function extractJsonBlocks(
  text: string,
  _options: { minSize?: number } = {},
): Array<{ start: number; end: number; text: string; isObject: boolean }> {
  if (!text || typeof text !== 'string') return [];

  const blocks: Array<{ start: number; end: number; text: string; isObject: boolean }> = [];
  let i = 0;

  while (i < text.length) {
    // Find opening bracket
    if (text[i] !== '{' && text[i] !== '[') {
      i++;
      continue;
    }

    const startIdx = i;
    const openChar = text[i];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let stringDelim: string | null = null;
    let isEscaped = false;
    let foundEnd = false;

    while (i < text.length) {
      const ch = text[i];

      if (isEscaped) {
        isEscaped = false;
        i++;
        continue;
      }

      if (ch === '\\' && inString) {
        isEscaped = true;
        i++;
        continue;
      }

      // String delimiter handling
      if ((ch === '"' || ch === "'" || ch === '`') && !inString) {
        inString = true;
        stringDelim = ch;
        i++;
        continue;
      }

      if (ch === stringDelim && inString) {
        inString = false;
        stringDelim = null;
        i++;
        continue;
      }

      if (inString) {
        i++;
        continue;
      }

      // Bracket counting
      if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          foundEnd = true;
          break;
        }
      }

      i++;
    }

    if (foundEnd) {
      const blockText = text.slice(startIdx, i + 1);
      blocks.push({
        start: startIdx,
        end: i,
        text: blockText,
        isObject: openChar === '{',
      });
      i++;
    } else {
      // Unbalanced - move past opening bracket and continue
      i = startIdx + 1;
    }
  }

  return blocks;
}

/**
 * Fix string concatenation hallucinations from LLMs.
 * Only runs at Tier 4 (desperation) - applies strict patterns to avoid
 * damaging valid content like mathematical expressions.
 */
export function scrubConcatenation(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // 1. Mid-string concatenation: "text" + "more" -> "textmore"
  // Match both standard (+) and full-width (＋) plus signs
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

  // 2. Multi-line concatenation: "text"\n+\n"more"
  result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(?:\r?\n)+\s*(["'])/g, '$1$2');
  result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(["'])/g, '$1$2');

  // 3. Dangling plus before punctuation: "text" + , -> "text" ,
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*([,}\]])/g, '$1$2');

  // 4. Trailing dangling plus: "text" + -> "text"
  result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*$/g, '$1');

  return result;
}

/**
 * Strip markdown code fences from content.
 * Handles both ``` and ~~~ fences, with or without language specifier.
 */
export function stripMarkdownFences(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const trimmed = text.trim();

  // Complete fences: ```json ... ``` or ~~~json ... ~~~
  const fenceMatch = trimmed.match(/^(?:```|~~~)(?:json)?\s*([\s\S]*?)\s*(?:```|~~~)$/i);
  if (fenceMatch) return fenceMatch[1].trim();

  let result = trimmed;
  // Unclosed opening fence: ```json\n{...}
  result = result.replace(/^(?:```|~~~)(?:json)?\s*/i, '');
  // Orphan closing fence: {...}\n```
  result = result.replace(/\s*(?:```|~~~)\s*$/i, '');

  return result.trim();
}

/**
 * Strip thinking/reasoning tags from LLM response
 */
export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  return (
    text
      // 1. Unwrap rogue tool_call tags to preserve inner JSON (CRITICAL: before stripping other tags!)
      // Pattern: <tool_call ...>content</tool_call> -> content
      .replace(/<tool_call(?:\s+[^>]*)?>\s*([\s\S]*?)\s*<\/tool_call>/gi, '$1')
      // Strip orphaned tool_call opening tags
      .replace(/<tool_call(?:\s+[^>]*)?>\s*/gi, '')
      // Strip orphaned tool_call closing tags
      .replace(/\s*<\/tool_call>\s*/gi, ' ')
      // Strip inner XML wrappers left behind after tool_call unwrapping (e.g. <json>...</json>)
      .replace(/<(json|arg_value|arguments|content)(?:\s+[^>]*)?>\s*([\s\S]*?)\s*<\/\1>/gi, '$2')

      // 2. Strip standard paired XML tags (tool_call removed - we unwrap it instead!)
      .replace(
        /<(think|thinking|thought|reasoning|reflection|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
        '',
      )
      // 3. Paired bracket tags (TOOL_CALL removed - we unwrap it instead!)
      .replace(/\[(THINK|THOUGHT|REASONING)\][\s\S]*?\[\/\1\]/gi, '')
      // 4. Asterisk thinking: *thinks* or *thought*
      .replace(/\*thinks?:[\s\S]*?\*/gi, '')
      // 5. Parenthesized thinking: (thinking: ...)
      .replace(/\(thinking:[\s\S]*?\)/gi, '')
      // 6. Orphaned closing tags (opening tag was in assistant prefill; tool_call removed)
      .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|search)>\s*/i, '')
      // 7. ideal_output: few-shot example wrapper that LLM sometimes reproduces after JSON
      .replace(/<\/ideal_output>\s*/gi, '')
      .trim()
  );
}

/**
 * Safely parse JSON with progressive fallback waterfall.
 * Returns Zod-style result object for maximum reusability.
 *
 * Flow:
 *   Input Validation -> stripThinkingTags -> Strip Fences -> Tier 1 (JSON.parse)
 *   -> Tier 2 (jsonrepair) -> Tier 3 (Normalize + Extract) -> Tier 4 (Scrub) -> Tier 5 (Failure)
 */
export function safeParseJSON<T>(
  input: unknown,
  options: {
    schema?: z.ZodType<T>;
    minimumBlockSize?: number;
    onError?: (context: {
      tier: number;
      originalLength: number;
      error: Error;
      sanitizedString?: string;
    }) => void;
  } = {},
): { success: boolean; data?: T; error?: Error; errorContext?: object } {
  const { schema, minimumBlockSize = 50, onError } = options;
  const originalLength = typeof input === 'string' ? input.length : 0;

  // === Tier 0: Input Validation ===
  if (input === null || input === undefined) {
    const error = new Error('Input is null or undefined');
    const context = { tier: 0, originalLength, error };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }

  // Already an object/array - return as-is
  if (typeof input === 'object') {
    const data = input as T;
    if (schema) {
      try {
        return { success: true, data: schema.parse(data) };
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        return { success: false, error, errorContext: { tier: 0, originalLength, error } };
      }
    }
    return { success: true, data };
  }

  // Coerce primitives to string
  let text = String(input);

  // Empty string check
  if (text.trim().length === 0) {
    const error = new Error('Input is empty or whitespace-only');
    const context = { tier: 0, originalLength, error };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }

  // Strip thinking tags FIRST (before any parsing)
  text = stripThinkingTags(text);

  // Strip markdown fences EARLY
  text = stripMarkdownFences(text);

  // === Tier 1: Native Parse ===
  try {
    const parsed = JSON.parse(text);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 2
  }

  // === Tier 2: Extract + JsonRepair ===
  try {
    const blocks = extractJsonBlocks(text);

    if (blocks.length > 0) {
      // Select last substantial block
      const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
      const selectedBlock =
        substantialBlocks.length > 0
          ? substantialBlocks[substantialBlocks.length - 1]
          : blocks[blocks.length - 1];

      const repaired = jsonrepair(selectedBlock.text);
      const parsed = JSON.parse(repaired);
      if (schema) {
        const data = schema.parse(parsed) as T;
        return { success: true, data };
      }
      return { success: true, data: parsed as T };
    }

    // No blocks found - apply jsonrepair to whole text
    const repaired = jsonrepair(text);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 3
  }

  // === Tier 3: Normalize + Extract ===
  try {
    const normalized = normalizeText(text);
    const blocks = extractJsonBlocks(normalized);

    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }

    const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
    const selectedBlock =
      substantialBlocks.length > 0
        ? substantialBlocks[substantialBlocks.length - 1]
        : blocks[blocks.length - 1];

    const repaired = jsonrepair(selectedBlock.text);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch {
    // Continue to Tier 4
  }

  // === Tier 4: Aggressive Scrub ===
  try {
    const normalized = normalizeText(text);
    const blocks = extractJsonBlocks(normalized);

    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }

    const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
    const selectedBlock =
      substantialBlocks.length > 0
        ? substantialBlocks[substantialBlocks.length - 1]
        : blocks[blocks.length - 1];

    const scrubbed = scrubConcatenation(selectedBlock.text);
    const repaired = jsonrepair(scrubbed);
    const parsed = JSON.parse(repaired);
    if (schema) {
      const data = schema.parse(parsed) as T;
      return { success: true, data };
    }
    return { success: true, data: parsed as T };
  } catch (e) {
    // === Tier 5: Fatal Failure ===
    const error = new Error(`JSON parse failed at all tiers: ${(e as Error).message}`);
    const context = {
      tier: 5,
      originalLength,
      sanitizedString: text.slice(0, 500),
      error,
    };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }
}
