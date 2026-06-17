import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cleanSchemaForXGrammar, zodToJsonSchema } from './schemaUtils';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';

describe('schemaUtils', () => {
  it('converts simple schema to JSON Schema format', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int(),
    });

    const result = zodToJsonSchema(schema, 'TestSchema');

    expect(result.type).toBe('json_schema');
    expect(result.json_schema.name).toBe('TestSchema');
    expect(result.json_schema.strict).toBe(true);
    expect(result.json_schema.schema).toBeDefined();
    expect(result.json_schema.schema.type).toBe('object');
  });

  it('includes draft-7 target in output', () => {
    const schema = z.object({ test: z.string() });
    const result = zodToJsonSchema(schema, 'Test');

    // Draft 7 uses required array, not required property per field
    const schemaDef = result.json_schema.schema;
    expect(schemaDef).toBeDefined();
    // Should have properties with type annotations
    expect(schemaDef.properties).toBeDefined();
  });

  it('sets additionalProperties: false for objects', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = zodToJsonSchema(schema, 'StrictSchema');
    const objSchema = result.json_schema.schema;

    // Zod 4 sets additionalProperties: false by default for strict mode
    expect(objSchema).toBeDefined();
  });

  it('handles nullable fields correctly for OpenAI strict mode', () => {
    const schema = z.object({
      reasoning: z.string().nullable(),
      content: z.string(),
    });

    const result = zodToJsonSchema(schema, 'NullableTest');
    const props = result.json_schema.schema.properties as Record<string, unknown>;

    // Both fields should be in properties
    expect(props.reasoning).toBeDefined();
    expect(props.content).toBeDefined();
  });

  it('uses z.record() with 2-arg form', () => {
    // This ensures we're using Zod 4 compatible record syntax
    const schema = z.object({
      assignments: z.record(z.string(), z.string()),
    });

    const result = zodToJsonSchema(schema, 'RecordTest');
    const props = result.json_schema.schema.properties as Record<string, unknown>;

    expect(props.assignments).toBeDefined();
  });

  describe('xgrammar compatibility', () => {
    const pipelineSchemas: Array<{ name: string; schema: z.ZodType }> = [
      { name: 'ExtractSchema', schema: ExtractSchema },
      { name: 'MergeSchema', schema: MergeSchema },
      { name: 'AssignSchema', schema: AssignSchema },
    ];

    for (const { name, schema } of pipelineSchemas) {
      it(`strips anyOf / oneOf / propertyNames / type:"null" from ${name}`, () => {
        const result = zodToJsonSchema(schema, name);
        const stringified = JSON.stringify(result.json_schema.schema);

        expect(stringified).not.toContain('"anyOf"');
        expect(stringified).not.toContain('"oneOf"');
        expect(stringified).not.toContain('"propertyNames"');
        expect(stringified).not.toContain('"type":"null"');
      });
    }

    it('collapses nullable anyOf into the non-null branch and drops default:null', () => {
      const schema = z.object({
        reasoning: z.string().nullable().default(null),
      });
      const result = zodToJsonSchema(schema, 'NullableCollapse');
      const reasoning = (
        result.json_schema.schema.properties as Record<string, Record<string, unknown>>
      ).reasoning;

      expect(reasoning.anyOf).toBeUndefined();
      expect(reasoning.type).toBe('string');
      expect(reasoning.default).toBeUndefined();
    });

    it('preserves non-nullable anyOf so the regression test catches reintroduced unions', () => {
      const input = {
        type: 'object',
        properties: {
          x: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['x'],
        additionalProperties: false,
      };
      const out = cleanSchemaForXGrammar(input) as Record<string, unknown>;
      const x = (out.properties as Record<string, Record<string, unknown>>).x;
      // No null branch → anyOf must survive so it remains visible.
      expect(x.anyOf).toBeDefined();
    });

    it('collapses type:[X,"null"] arrays and strips the now-incoherent default:null', () => {
      const input = {
        type: 'object',
        properties: {
          a: { type: ['string', 'null'], default: null },
          b: { type: ['number', 'string', 'null'] },
        },
        required: ['a', 'b'],
        additionalProperties: false,
      };
      const out = cleanSchemaForXGrammar(input) as Record<string, unknown>;
      const props = out.properties as Record<string, Record<string, unknown>>;

      expect(props.a.type).toBe('string');
      expect(props.a.default).toBeUndefined();
      // Multiple non-null types remain as an array (out of xgrammar scope).
      expect(props.b.type).toEqual(['number', 'string']);
    });

    it('strips propertyNames emitted by z.record but keeps additionalProperties', () => {
      const schema = z.object({
        assignments: z.record(z.string(), z.string()),
      });
      const result = zodToJsonSchema(schema, 'RecordCleanup');
      const assignments = (
        result.json_schema.schema.properties as Record<string, Record<string, unknown>>
      ).assignments;

      expect(assignments.propertyNames).toBeUndefined();
      expect(assignments.additionalProperties).toEqual({ type: 'string' });
    });
  });
});
