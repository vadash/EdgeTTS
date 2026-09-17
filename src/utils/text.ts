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

  return text
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[\u2028\u2029]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Strip markdown, decorative glyph runs, HTML, and control chars from speaker text for TTS.
 */
export function sanitizeText(text: string): string {
  let result = text;

  // 1. Markdown headers
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 2. Markdown bold/italic (longest first)
  result = result.replace(/\*{3}([^*]+)\*{3}/g, '$1');
  result = result.replace(/\*{2}([^*]+)\*{2}/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_{3}([^_]+)_{3}/g, '$1');
  result = result.replace(/_{2}([^_]+)_{2}/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // 3. Strikethrough
  result = result.replace(/~~([^~]+)~~/g, '$1');

  // 4. Inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // 5. HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // 6. Decorative character runs (3+ consecutive identical characters) -> pause marker
  // Handles: ___, ¯¯¯, ***, ~~~, ===, ---, •••, ···, ───, ═══
  // IMPORTANT: Apply AFTER markdown stripping to avoid breaking patterns like **bold**
  result = result.replace(/¯{3,}/g, '...');
  result = result.replace(/_{3,}/g, '...');
  result = result.replace(/\*{3,}/g, '...');
  result = result.replace(/~{3,}/g, '...');
  result = result.replace(/={3,}/g, '...');
  result = result.replace(/-{3,}/g, '...');
  result = result.replace(/•{3,}/g, '...');
  result = result.replace(/·{3,}/g, '...');
  result = result.replace(/─{3,}/g, '...');
  result = result.replace(/═{3,}/g, '...');

  // 7. Zero-width characters and byte order mark
  result = result.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 8. Control characters (except newlines, tabs)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 9. Remaining symbols; "&" becomes the word "and"
  result = result.replace(/[|\\^]/g, '');
  result = result.replace(/&/g, ' and ');

  // 10. Multiple spaces
  result = result.replace(/ {2,}/g, ' ');

  return result.trim();
}

/**
 * Extract all balanced JSON blocks from a string.
 * The scanner tracks string literals and escape sequences, so brackets
 * inside strings do not affect nesting.
 */
export function extractJsonBlocks(
  text: string,
  _options: { minSize?: number } = {},
): Array<{ start: number; end: number; text: string; isObject: boolean }> {
  if (!text || typeof text !== 'string') return [];

  const blocks: Array<{ start: number; end: number; text: string; isObject: boolean }> = [];
  let i = 0;

  while (i < text.length) {
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
      // No matching close: move past the opening bracket and rescan
      i = startIdx + 1;
    }
  }

  return blocks;
}

/**
 * Fix string concatenation hallucinations from LLMs.
 * Runs only at Tier 4 of safeParseJSON; the strict patterns avoid damaging
 * valid content such as mathematical expressions.
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
 * Strip thinking/reasoning tags from LLM response.
 * Uses index-based extraction for potentially massive blocks (think/thinking/reasoning)
 * to avoid regex performance issues on unclosed tags.
 */
export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;

  // 1. Regex for small/orphaned tags that don't span massive text blocks
  let result = text
    // Unwrap rogue tool_call tags to preserve the inner JSON; run this before the other strips
    // Pattern: <tool_call ...>content</tool_call> -> content
    .replace(/<(?:json_)?tool_call(?:\s+[^>]*)?>\s*([\s\S]*?)\s*<\/(?:json_)?tool_call>/gi, '$1')
    // Strip orphaned tool_call opening tags
    .replace(/<(?:json_)?tool_call(?:\s+[^>]*)?>\s*/gi, '')
    // Strip orphaned tool_call closing tags
    .replace(/\s*<\/(?:json_)?tool_call>\s*/gi, ' ')
    // Strip arg_key tags entirely (remove both tag and content)
    .replace(/<arg_key[^>]*>[\s\S]*?<\/arg_key>/gi, '')
    // Strip inner XML wrappers left behind after tool_call unwrapping (e.g. <json>...</json>)
    .replace(/<(json|arg_value|arguments|content)(?:\s+[^>]*)?>\s*([\s\S]*?)\s*<\/\1>/gi, '$2')
    // Paired bracket tags
    .replace(/\[(THINK|THOUGHT|REASONING)\][\s\S]*?\[\/\1\]/gi, '')
    // Asterisk thinking: *thinks* or *thought*
    .replace(/\*thinks?:[\s\S]*?\*/gi, '')
    // Parenthesized thinking: (thinking: ...)
    .replace(/\(thinking:[\s\S]*?\)/gi, '')
    // ideal_output: few-shot example wrapper that LLM sometimes reproduces after JSON
    .replace(/<\/ideal_output>\s*/gi, '');

  // 2. Index-based extraction for potentially massive thinking/reasoning blocks.
  //    Avoids regex [\s\S]*? which can be slow on unclosed tags.
  //    Unclosed tags are preserved (no closing tag = no removal).
  const tagsToStrip = ['think', 'thinking', 'thought', 'reasoning', 'reflection', 'search'];

  for (const tag of tagsToStrip) {
    const openTag = `<${tag}`;
    const closeTag = `</${tag}>`;
    const openLen = openTag.length;

    let searchStart = 0;
    while (searchStart < result.length) {
      const lower = result.toLowerCase();
      const openIdx = lower.indexOf(openTag, searchStart);

      if (openIdx === -1) break;

      // Advance past the tag name and any attributes (find closing '>')
      const gtIdx = result.indexOf('>', openIdx + openLen);
      if (gtIdx === -1) break; // Malformed tag, leave as-is

      const closeIdx = lower.indexOf(closeTag, gtIdx);
      if (closeIdx !== -1) {
        // Remove the entire block: from '<tag...' to '</tag>'
        result = result.slice(0, openIdx) + result.slice(closeIdx + closeTag.length);
        // Do not advance searchStart: the slice shifted the content, so rescan this position
      } else {
        // Unclosed tag: the text stays by test design; move past this tag
        searchStart = gtIdx + 1;
      }
    }
  }

  // 3. Orphaned closing tags (opening tag was in assistant prefill)
  //    Strip everything before the first orphaned closing tag at the start
  result = result.replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|search)>\s*/i, '');

  return result.trim();
}

/**
 * Apply array-at-root recovery if parsed value is an array and schema expects an object with array field.
 * Detects when LLM returns a naked array instead of {reasoning: null, items: [...]} structure.
 */
function applyArrayAtRootRecovery<T>(parsed: unknown, schema: z.ZodType<T>): unknown {
  if (!Array.isArray(parsed)) return parsed;

  const zodObj = schema as unknown as { _def?: { shape?: Record<string, unknown> } };
  if (!zodObj._def?.shape) return parsed;

  const shape = zodObj._def.shape;
  const arrayFields = Object.entries(shape).filter(([_, fieldSchema]) => {
    // ZodArray has 'type' property (not 'typeName') set to 'array'
    const fieldDef = (fieldSchema as unknown as { _def?: { type?: string } })._def;
    return fieldDef?.type === 'array';
  });

  // With zero or several array fields, the target field is ambiguous, so keep
  // the value as parsed
  if (arrayFields.length === 1) {
    const [fieldName] = arrayFields[0];
    return { reasoning: null, [fieldName]: parsed };
  }

  return parsed;
}

/**
 * Apply flattened assignments recovery if parsed value is a numeric-key object
 * and schema expects an object with 'assignments' field.
 * Detects when LLM returns {"0": "A", "1": "B"} instead of {reasoning: null, assignments: {"0": "A", "1": "B"}}.
 */
function applyFlattenedAssignmentsRecovery<T>(parsed: unknown, schema: z.ZodType<T>): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }

  const zodObj = schema as unknown as { _def?: { shape?: Record<string, unknown> } };
  if (!zodObj._def?.shape) return parsed;

  const recognizedKeys = ['reasoning', 'assignments', 'characters', 'merges'];
  const hasRecognizedKey = recognizedKeys.some((key) => key in (parsed as object));

  // If object has recognized keys, it's already structured correctly
  if (hasRecognizedKey) return parsed;

  const keys = Object.keys(parsed);
  if (keys.length === 0) return parsed;

  const allNumeric = keys.every((key) => /^\d+$/.test(key));

  if (allNumeric) {
    return { reasoning: null, assignments: parsed };
  }

  return parsed;
}

/**
 * Shape a parsed value: apply recovery heuristics for common LLM malformations,
 * then validate against the schema (or cast when absent).
 */
function shapeResult<T>(parsed: unknown, schema: z.ZodType<T> | undefined): T {
  if (!schema) {
    return parsed as T;
  }
  let recovered = applyArrayAtRootRecovery(parsed, schema);
  recovered = applyFlattenedAssignmentsRecovery(recovered, schema);
  return schema.parse(recovered) as T;
}

/**
 * Core tier pipeline: repair a candidate string via jsonrepair, parse it,
 * apply recovery heuristics, and validate against the schema. Throws on any
 * failure so the caller advances to the next tier.
 */
function parseRepaired<T>(candidate: string, schema: z.ZodType<T> | undefined): T {
  return shapeResult(JSON.parse(jsonrepair(candidate)), schema);
}

/**
 * Select the last block of at least minimumBlockSize characters, falling back
 * to the last block of any size.
 */
function selectBlockText(blocks: Array<{ text: string }>, minimumBlockSize: number): string {
  const substantial = blocks.filter((b) => b.text.length >= minimumBlockSize);
  const selected =
    substantial.length > 0 ? substantial[substantial.length - 1] : blocks[blocks.length - 1];
  return selected.text;
}

/**
 * Safely parse JSON with a progressive fallback waterfall: each tier applies
 * a more aggressive repair than the last. The first successful tier returns;
 * total failure returns success: false instead of throwing.
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

  // Objects and arrays skip the string tiers and go straight to schema validation
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

  let text = String(input);

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

  // No JSON delimiters anywhere => the model returned prose, not structured
  // output. Bailing here avoids jsonrepair fabricating a plausible-but-wrong
  // object (e.g. characters: ["Mary","John"]) out of plain English, which
  // surfaces downstream as a confusing Zod "expected object, received string".
  if (!text.includes('{') && !text.includes('[')) {
    const error = new Error(
      `Model returned no JSON (got ${text.length} chars of prose): "${text.slice(0, 120).replace(/\s+/g, ' ')}…"`,
    );
    const context = { tier: 0, originalLength, error };
    onError?.(context);
    return { success: false, error, errorContext: context };
  }
  // === Tier 1: Native Parse ===
  try {
    return { success: true, data: shapeResult(JSON.parse(text), schema) };
  } catch {
    // Continue to Tier 2
  }

  // === Tier 2: Extract + JsonRepair ===
  try {
    const blocks = extractJsonBlocks(text);
    const candidate = blocks.length > 0 ? selectBlockText(blocks, minimumBlockSize) : text;
    return { success: true, data: parseRepaired(candidate, schema) };
  } catch {
    // Continue to Tier 3
  }

  // === Tier 3: Normalize + Extract ===
  try {
    const blocks = extractJsonBlocks(normalizeText(text));
    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }
    return {
      success: true,
      data: parseRepaired(selectBlockText(blocks, minimumBlockSize), schema),
    };
  } catch {
    // Continue to Tier 4
  }

  // === Tier 4: Aggressive Scrub ===
  try {
    const blocks = extractJsonBlocks(normalizeText(text));
    if (blocks.length === 0) {
      throw new Error('No JSON blocks found');
    }
    const scrubbed = scrubConcatenation(selectBlockText(blocks, minimumBlockSize));
    return { success: true, data: parseRepaired(scrubbed, schema) };
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
