/**
 * Pure per-provider wire-schema sanitization (ADR-0021): strict-mode families
 * demand `required` ⊇ every `properties` key and a boolean
 * `additionalProperties`. A dynamic-key record (an object level with no
 * `properties`) cannot be expressed under strict mode: `additionalProperties:
 * false` there lets an enforcing consumer coerce the record to `{}`, so the
 * key is deleted entirely and an enforcing consumer rejects the schema at
 * request time instead — a deterministic failure the pass routes to the
 * Backup split, while lenient consumers no longer see an object form.
 *
 * One conservative profile serves the openai and unknown families: the
 * evidence covers exactly two failure modes, and mistral never receives a
 * json_schema at all (ADR-0021).
 */
import type { JsonSchemaNode } from './schemaUtils';

export const isObject = (value: unknown): value is JsonSchemaNode =>
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
    if (key === 'additionalProperties' && isObject(value)) continue; // re-added as false below where properties exist
    out[key] = sanitizeNode(value);
  }

  if (isObject(out.properties)) {
    // Strict-mode shape: `required` must list every property key and nothing
    // else, and a dropped object form re-enters as false.
    if ('additionalProperties' in node && !('additionalProperties' in out)) {
      out.additionalProperties = false;
    }
    out.required = Object.keys(out.properties);
  } else if ('additionalProperties' in out) {
    // Dynamic-key record: no additionalProperties survives, in any form.
    delete out.additionalProperties;
  }

  return out;
}
