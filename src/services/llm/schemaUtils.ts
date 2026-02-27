import { z } from 'zod';

export interface StructuredCallOptions<T> {
  prompt: {
    system: string;
    user: string;
  };
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

/**
 * Convert Zod schema to OpenAI Structured Outputs format
 * Uses Zod 4's native toJSONSchema() method
 *
 * @param schema - Zod schema to convert
 * @param schemaName - Name for the schema (used in OpenAI request)
 * @returns OpenAI-compatible response_format object
 */
export function zodToJsonSchema<T>(schema: z.ZodType<T>, schemaName: string): JSONSchemaFormat {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      strict: true,
      // Zod 4 native toJSONSchema() - no external package needed
      // target: 'draft-7' ensures OpenAI compatibility (default Draft 2020-12
      // may use keywords like 'prefixItems' that OpenAI doesn't recognize)
      schema: z.toJSONSchema(schema, { target: 'draft-7' }),
    },
  };
}
