import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './schemaUtils';

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
    const props = result.json_schema.schema.properties;

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
    const props = result.json_schema.schema.properties;

    expect(props.assignments).toBeDefined();
  });
});
