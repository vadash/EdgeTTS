import type { ReasoningLevel } from '@/state/types';

/**
 * Connection pool parsing (ADR-0022). One non-blank line is one Pool entry in
 * JSONL form. Unknown fields fail the parse because the allowlist is closed;
 * `type` is the one accepted-and-ignored key (transport is always
 * OpenAI-compatible).
 */

/** `reasoning_effort` levels accepted from a Pool entry; any other string fails the parse. */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const satisfies readonly Exclude<
  ReasoningLevel,
  'auto'
>[];
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** The one vendor template keyword the pool forwards; other kwargs stay rejected. */
export interface ThinkingTemplateKwargs {
  enable_thinking?: boolean;
}

/** One line of the Connection pool with the wire field names used by the JSONL. */
export interface PoolEntry {
  url: string;
  key: string;
  name?: string;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  max_input_tokens?: number;
  chat_template_kwargs?: ThinkingTemplateKwargs;
  enable_thinking?: boolean;
  reasoning_effort?: ReasoningEffort;
}

export class PoolParseError extends Error {
  readonly line: number;

  constructor(line: number, reason: string) {
    super(`Line ${line}: ${reason}`);
    this.name = 'PoolParseError';
    this.line = line;
  }
}

const ALLOWED_FIELDS = {
  url: true,
  key: true,
  name: true,
  model: true,
  temperature: true,
  max_output_tokens: true,
  max_input_tokens: true,
  chat_template_kwargs: true,
  enable_thinking: true,
  reasoning_effort: true,
  type: true,
} as const;

function fail(line: number, reason: string): never {
  throw new PoolParseError(line, reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the Pool textarea. Returns entries in source order (duplicates are
 * extra slots). Throws PoolParseError with the 1-based source line for the
 * first invalid line; blank lines are skipped and do not validate.
 */
export function parsePoolTextarea(raw: string): PoolEntry[] {
  const entries: PoolEntry[] = [];

  raw.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (text.trim() === '') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(line, 'invalid JSON');
    }

    if (!isPlainObject(parsed)) fail(line, 'entry must be a JSON object');

    for (const field of Object.keys(parsed)) {
      if (!Object.hasOwn(ALLOWED_FIELDS, field)) fail(line, `unknown field "${field}"`);
    }

    const { url, key } = parsed;
    if (url === undefined || url === null) fail(line, 'url is required');
    if (typeof url !== 'string') fail(line, 'url must be a string');
    if (url.trim() === '') fail(line, 'url is required');
    if (key === undefined || key === null) fail(line, 'key is required');
    if (typeof key !== 'string') fail(line, 'key must be a string');
    if (key.trim() === '') fail(line, 'key is required');

    for (const field of ['name', 'model'] as const) {
      const value = parsed[field];
      if (value !== undefined && typeof value !== 'string') {
        fail(line, `${field} must be a string`);
      }
    }

    if (
      parsed.temperature !== undefined &&
      (typeof parsed.temperature !== 'number' || !Number.isFinite(parsed.temperature))
    ) {
      fail(line, 'temperature must be a number');
    }

    for (const field of ['max_output_tokens', 'max_input_tokens'] as const) {
      const value = parsed[field];
      if (value !== undefined && (!Number.isInteger(value) || (value as number) <= 0)) {
        fail(line, `${field} must be a positive integer`);
      }
    }

    if (parsed.chat_template_kwargs !== undefined) {
      if (!isPlainObject(parsed.chat_template_kwargs)) {
        fail(line, 'chat_template_kwargs must be an object');
      }
      const kwargs = parsed.chat_template_kwargs;
      const valid = Object.entries(kwargs).every(
        ([key, value]) => key === 'enable_thinking' && typeof value === 'boolean',
      );
      if (!valid) fail(line, 'chat_template_kwargs supports only enable_thinking: boolean');
    }

    if (parsed.enable_thinking !== undefined && typeof parsed.enable_thinking !== 'boolean') {
      fail(line, 'enable_thinking must be a boolean');
    }

    if (parsed.reasoning_effort !== undefined && typeof parsed.reasoning_effort !== 'string') {
      fail(line, 'reasoning_effort must be a string');
    }
    if (
      parsed.reasoning_effort !== undefined &&
      !REASONING_EFFORTS.includes(parsed.reasoning_effort as ReasoningEffort)
    ) {
      fail(line, 'reasoning_effort must be one of low, medium, high');
    }

    const entry: PoolEntry = { url, key };
    if (parsed.name !== undefined) entry.name = parsed.name as string;
    if (parsed.model !== undefined) entry.model = parsed.model as string;
    if (parsed.temperature !== undefined) entry.temperature = parsed.temperature as number;
    if (parsed.max_output_tokens !== undefined) {
      entry.max_output_tokens = parsed.max_output_tokens as number;
    }
    if (parsed.max_input_tokens !== undefined) {
      entry.max_input_tokens = parsed.max_input_tokens as number;
    }
    if (parsed.chat_template_kwargs !== undefined) {
      entry.chat_template_kwargs = parsed.chat_template_kwargs as ThinkingTemplateKwargs;
    }
    if (parsed.enable_thinking !== undefined) {
      entry.enable_thinking = parsed.enable_thinking as boolean;
    }
    if (parsed.reasoning_effort !== undefined) {
      entry.reasoning_effort = parsed.reasoning_effort as ReasoningEffort;
    }

    entries.push(entry);
  });

  return entries;
}
