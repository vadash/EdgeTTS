import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';
import { zodToJsonSchema } from './schemaUtils';
import { isObject, sanitizeWireSchema } from './wireSchema';

/**
 * Strict mode demands, at every object level: `required` covers exactly the
 * `properties` keys, and `additionalProperties` is boolean or absent. A
 * dynamic-key record (no `properties`) carries no `additionalProperties` at
 * all: `false` there lets an enforcing consumer coerce the record to {}.
 */
function assertWireSafe(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertWireSafe);
    return;
  }
  if (!isObject(node)) return;

  if (isObject(node.properties)) {
    expect(node.required).toEqual(Object.keys(node.properties));
    if ('additionalProperties' in node) {
      expect(typeof node.additionalProperties).toBe('boolean');
    }
  } else {
    expect(node).not.toHaveProperty('additionalProperties');
  }
  Object.values(node).forEach(assertWireSafe);
}

describe('sanitizeWireSchema', () => {
  it('turns object-form additionalProperties into false on property-ful levels', () => {
    const input = {
      type: 'object',
      properties: {
        meta: { type: 'object', properties: {}, additionalProperties: { type: 'string' } },
      },
      additionalProperties: { type: 'string' },
    };

    const out = sanitizeWireSchema(input);

    expect(out.additionalProperties).toBe(false);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.meta.additionalProperties).toBe(false);
  });

  it('deletes additionalProperties entirely on property-less record levels', () => {
    const input = {
      type: 'object',
      properties: {
        map: { type: 'object', additionalProperties: { type: 'string' } },
        closed: { type: 'object', additionalProperties: false },
      },
    };

    const out = sanitizeWireSchema(input);
    const props = out.properties as Record<string, Record<string, unknown>>;

    expect(props.map).not.toHaveProperty('additionalProperties');
    expect(props.closed).not.toHaveProperty('additionalProperties');
    // A property-ful sibling keeps the strict-mode shape; absent stays absent.
    expect(out.required).toEqual(['map', 'closed']);
  });

  it('extends required to cover every property key at every depth', () => {
    const input = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nested: {
          type: 'object',
          properties: { inner: { type: 'number' } },
          required: ['inner'],
        },
      },
      required: ['name'],
    };

    const out = sanitizeWireSchema(input);

    expect(out.required).toEqual(['name', 'nested']);
    expect((out.properties as Record<string, Record<string, unknown>>).nested.required).toEqual([
      'inner',
    ]);
  });

  it('drops required keys that are not property keys', () => {
    const input = {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
      required: ['reasoning', 'assignments'],
    };

    const out = sanitizeWireSchema(input);

    expect(out.required).toEqual(['reasoning']);
  });

  it('adds a full required list when required is missing', () => {
    const input = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    };

    const out = sanitizeWireSchema(input);

    expect(out.required).toEqual(['a', 'b']);
  });

  it('leaves boolean additionalProperties as-is', () => {
    const input = { type: 'object', properties: {}, additionalProperties: true };

    expect(sanitizeWireSchema(input).additionalProperties).toBe(true);
  });

  it('drops the $schema keyword', () => {
    const input = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { a: { type: 'string' } },
    };

    expect('$schema' in sanitizeWireSchema(input)).toBe(false);
  });

  it('passes through schemas without the offending features unchanged', () => {
    const input = {
      type: 'string',
      minLength: 1,
      enum: ['male', 'female'],
      anyOf: [{ type: 'string' }, { type: 'number' }],
    };

    expect(sanitizeWireSchema(input)).toEqual(input);
  });

  it('does not mutate its input', () => {
    const input = {
      type: 'object',
      properties: {
        map: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: [],
    };
    const snapshot = structuredClone(input);

    sanitizeWireSchema(input);

    expect(input).toEqual(snapshot);
  });

  describe('real pass schemas come out wire-safe', () => {
    type PassSchema = typeof ExtractSchema | typeof MergeSchema | typeof AssignSchema;
    const cases: Array<[string, PassSchema]> = [
      ['ExtractSchema', ExtractSchema],
      ['MergeSchema', MergeSchema],
      ['AssignSchema', AssignSchema],
    ];

    for (const [name, schema] of cases) {
      it(`sanitizes ${name}`, () => {
        const wire = zodToJsonSchema(schema as z.ZodType, name).json_schema.schema;

        assertWireSafe(sanitizeWireSchema(wire));
      });
    }

    it('gives the Assign record no additionalProperties key', () => {
      const wire = zodToJsonSchema(AssignSchema, 'AssignSchema').json_schema.schema;

      const assignments = (sanitizeWireSchema(wire).properties as Record<string, unknown>)
        .assignments as Record<string, unknown>;
      expect(assignments).not.toHaveProperty('additionalProperties');
    });
  });
});
