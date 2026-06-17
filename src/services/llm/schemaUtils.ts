import { z } from 'zod';

export interface StructuredCallOptions<T> {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}

export type JSONSchemaFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

type JsonSchemaNode = Record<string, unknown>;

/**
 * If `value` is an `anyOf`/`oneOf` array containing a `{type:"null"}` branch,
 * return the collapsed non-null payload (or undefined to let it pass through).
 * - Single non-null branch: returned as-is.
 * - Multiple non-null branches: returned as `{anyOf: [...]}` so the regression
 *   test still flags reintroduced unions rather than silently masking them.
 */
function collapseNullableUnion(value: unknown): unknown | undefined {
  if (!Array.isArray(value)) return undefined;
  const isNull = (item: unknown): boolean =>
    item !== null && typeof item === 'object' && (item as JsonSchemaNode).type === 'null';
  if (!value.some(isNull)) return undefined;
  const nonNull = value.filter((item) => !isNull(item));
  if (nonNull.length === 0) return undefined;
  if (nonNull.length === 1) return nonNull[0];
  return { anyOf: nonNull };
}

/**
 * Recursively strip JSON Schema keywords that xgrammar (vLLM / NVIDIA NIM)
 * refuses to compile. Operates on the wire schema only; runtime Zod types
 * are untouched.
 *
 * - `propertyNames` (emitted by `z.record(...)`): stripped.
 * - `anyOf`/`oneOf` containing a `{type:"null"}` branch: collapsed into the
 *   non-null branch.
 * - `type: [X, "null"]` arrays: collapsed to `type: X`.
 * - `default: null` left on a now-non-nullable node: stripped (ignored by
 *   strict-mode validators but incoherent once `null` is gone).
 *
 * Exported for direct unit testing of edge cases that draft-7 emission
 * doesn't naturally produce from Zod.
 */
export function cleanSchemaForXGrammar(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(cleanSchemaForXGrammar);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const input = node as JsonSchemaNode;
  const out: JsonSchemaNode = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === 'propertyNames') continue;

    if (key === 'anyOf' || key === 'oneOf') {
      const collapsed = collapseNullableUnion(value);
      if (collapsed !== undefined) {
        const cleaned = cleanSchemaForXGrammar(collapsed) as JsonSchemaNode;
        Object.assign(out, cleaned);
        continue;
      }
    }

    out[key] = cleanSchemaForXGrammar(value);
  }

  if (Array.isArray(out.type)) {
    const nonNull = out.type.filter((t) => t !== 'null');
    out.type = nonNull.length === 1 ? nonNull[0] : nonNull;
  }

  if (out.default === null && out.type !== 'null' && !('anyOf' in out) && !('oneOf' in out)) {
    delete out.default;
  }

  return out;
}

/**
 * Convert Zod schema to OpenAI Structured Outputs format.
 * Uses Zod 4's native toJSONSchema() method, then strips keywords that break
 * xgrammar-constrained upstreams (vLLM, NVIDIA NIM).
 */
export function zodToJsonSchema<T>(schema: z.ZodType<T>, schemaName: string): JSONSchemaFormat {
  const raw = z.toJSONSchema(schema, { target: 'draft-7' });
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      strict: true,
      schema: cleanSchemaForXGrammar(raw) as Record<string, unknown>,
    },
  };
}
