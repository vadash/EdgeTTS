import { z } from 'zod';

/**
 * CRITICAL: .nullable() not .optional() for OpenAI strict: true compatibility
 * .optional() omits from required array, breaking strict mode
 * .transform() converts null → undefined for clean domain types
 */
const baseSchema = z.object({
  reasoning: z.string().nullable().transform(v => v ?? undefined),
});

// Extract stage schemas
export const ExtractCharacterSchema = z.object({
  canonicalName: z.string().min(1),
  variations: z.array(z.string().min(1)),
  gender: z.enum(['male', 'female', 'unknown']),
});

export const ExtractSchema = baseSchema.extend({
  characters: z.array(ExtractCharacterSchema).min(1),
});

// Merge stage schema
export const MergeSchema = baseSchema.extend({
  merges: z.array(
    z.array(z.number().int().min(0)).min(2) // Each group has 2+ indices
  ),
});

// Assign stage schema
// NOTE: z.record() requires 2 args in Zod 4 (single-arg form removed)
export const AssignSchema = baseSchema.extend({
  assignments: z.record(z.string(), z.string()), // Sparse: {"0": "A", "5": "B"}
});

// Type exports
export type ExtractResponse = z.infer<typeof ExtractSchema>;
export type MergeResponse = z.infer<typeof MergeSchema>;
export type AssignResponse = z.infer<typeof AssignSchema>;
