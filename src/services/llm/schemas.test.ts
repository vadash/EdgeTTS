import { describe, it, expect } from 'vitest';
import {
  ExtractSchema, ExtractCharacterSchema,
  MergeSchema, AssignSchema,
  type ExtractResponse, type MergeResponse, type AssignResponse
} from './schemas';

describe('Zod Schemas', () => {
  describe('ExtractCharacterSchema', () => {
    it('accepts valid character', () => {
      const result = ExtractCharacterSchema.safeParse({
        canonicalName: 'Alice',
        variations: ['Alice', 'Al'],
        gender: 'female'
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty canonicalName', () => {
      const result = ExtractCharacterSchema.safeParse({
        canonicalName: '',
        variations: ['x'],
        gender: 'male'
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid gender', () => {
      const result = ExtractCharacterSchema.safeParse({
        canonicalName: 'Bob',
        variations: ['Bob'],
        gender: 'invalid'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ExtractSchema', () => {
    it('accepts valid response with reasoning', () => {
      const result = ExtractSchema.safeParse({
        reasoning: 'Found 2 characters',
        characters: [
          { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }
        ]
      });
      expect(result.success).toBe(true);
    });

    it('accepts null reasoning (transformed to undefined)', () => {
      const result = ExtractSchema.safeParse({
        reasoning: null,
        characters: [
          { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }
        ]
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reasoning).toBeUndefined();
      }
    });

    it('rejects missing characters array', () => {
      const result = ExtractSchema.safeParse({ reasoning: null });
      expect(result.success).toBe(false);
    });

    it('rejects empty characters array', () => {
      const result = ExtractSchema.safeParse({
        reasoning: null,
        characters: []
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MergeSchema', () => {
    it('accepts valid merge groups', () => {
      const result = MergeSchema.safeParse({
        reasoning: null,
        merges: [[0, 1], [2, 3]]
      });
      expect(result.success).toBe(true);
    });

    it('rejects single-element groups', () => {
      const result = MergeSchema.safeParse({
        reasoning: null,
        merges: [[0]]
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative indices', () => {
      const result = MergeSchema.safeParse({
        reasoning: null,
        merges: [[-1, 0]]
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AssignSchema', () => {
    it('accepts valid sparse assignments', () => {
      const result = AssignSchema.safeParse({
        reasoning: 'Assigning speakers',
        assignments: { '0': 'A', '5': 'B', '12': 'C' }
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty assignments (edge case)', () => {
      const result = AssignSchema.safeParse({
        reasoning: null,
        assignments: {}
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Type exports', () => {
    it('ExtractResponse matches inferred type', () => {
      const data: ExtractResponse = {
        reasoning: 'test',
        characters: [{ canonicalName: 'X', variations: ['X'], gender: 'male' }]
      };
      expect(ExtractSchema.safeParse(data).success).toBe(true);
    });

    it('MergeResponse matches inferred type', () => {
      const data: MergeResponse = {
        reasoning: null,
        merges: [[0, 1]]
      };
      expect(MergeSchema.safeParse(data).success).toBe(true);
    });

    it('AssignResponse matches inferred type', () => {
      const data: AssignResponse = {
        reasoning: undefined,
        assignments: { '0': 'A' }
      };
      // To parse into the inferred type, we must pass null (which transforms to undefined)
      const parseResult = AssignSchema.safeParse({ reasoning: null, assignments: { '0': 'A' } });
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        // After transform, reasoning is undefined
        expect(parseResult.data.reasoning).toBe(undefined);
      }
    });
  });
});
