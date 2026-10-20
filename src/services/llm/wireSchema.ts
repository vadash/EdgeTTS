/**
 * Pure per-provider wire-schema sanitization (ADR-0021): strict-mode families
 * demand `required` ⊇ every `properties` key and a boolean
 * `additionalProperties`; a dynamic-key record cannot be expressed under
 * strict mode, so `additionalProperties: false` there trades the record's
 * dynamic keys away on enforcing consumers while lenient consumers are
 * unaffected.
 */
type JsonSchemaNode = Record<string, unknown>;

const isObject = (value: unknown): value is JsonSchemaNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Return a wire-safe deep copy of a JSON Schema destined for
 * `response_format.json_schema`. Conservative: providers that accepted the
 * input receive an equivalent schema. The input is never mutated.
 */
export function sanitizeWireSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema) as Record<string, unknown>;
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeNode);
  }
  if (!isObject(node)) {
    return node;
  }

  const out: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue; // pure metadata; some strict validators reject unknown top-level keywords
    if (key === 'additionalProperties' && isObject(value)) continue; // re-added as false below
    out[key] = sanitizeNode(value);
  }
  if ('additionalProperties' in node && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }

  // Strict-mode shape: `required` must list every property key and nothing else.
  if (isObject(out.properties)) {
    out.required = Object.keys(out.properties);
  }

  return out;
}
