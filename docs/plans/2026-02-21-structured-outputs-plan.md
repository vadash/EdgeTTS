# Implementation Plan - Structured Outputs Refactor

> **Reference:** `docs/designs/2026-02-21-structured-outputs-refactor-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

This plan migrates the LLM response handling from repair-based parsing to OpenAI Structured Outputs with `strict: true`. All validation and repair code will be removed, replaced by Zod v4 schemas.

**Estimated completion:** 460 lines removed (60% reduction in LLM handling code)

---

## Task 1: Install Dependencies

**Goal:** Install Zod v4, remove jsonrepair dependency

### Step 1: Install Zod v4
```bash
npm install zod@^4
```
**Verify:** Check package.json has `zod: ^4`

### Step 2: Remove jsonrepair
```bash
npm uninstall jsonrepair
```
**Verify:** Check package.json does NOT have `jsonrepair`

### Step 3: Type check
```bash
npm run typecheck
```
**Expect:** Pass (no errors yet - old code still works)

### Step 4: Git commit
```bash
git add package.json package-lock.json
git commit -m "deps: add zod@^4, remove jsonrepair"
```

---

## Task 2: Create Zod Schemas

**Goal:** Create schema definitions with Zod v4

### Step 1: Write failing test
**File:** `src/services/llm/schemas.test.ts`
```typescript
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
      expect(AssignSchema.safeParse(data).success).toBe(true);
    });
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/schemas.test.ts
```
**Expect:** "Cannot find module './schemas'" or similar error

### Step 3: Implementation (Green)
**File:** `src/services/llm/schemas.ts`
```typescript
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
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/schemas.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/schemas.ts src/services/llm/schemas.test.ts
git commit -m "feat: add Zod v4 schemas for structured outputs"
```

---

## Task 3: Create schemaUtils with Native Zod toJSONSchema

**Goal:** Create JSON Schema conversion using Zod v4 native method

### Step 1: Write failing test
**File:** `src/services/llm/schemaUtils.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from './schemaUtils';
import { z } from 'zod';

describe('schemaUtils', () => {
  it('converts simple schema to JSON Schema format', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int()
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
      optional: z.string().optional()
    });

    const result = zodToJsonSchema(schema, 'StrictSchema');
    const objSchema = result.json_schema.schema;

    // Zod 4 sets additionalProperties: false by default for strict mode
    expect(objSchema).toBeDefined();
  });

  it('handles nullable fields correctly for OpenAI strict mode', () => {
    const schema = z.object({
      reasoning: z.string().nullable(),
      content: z.string()
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
      assignments: z.record(z.string(), z.string())
    });

    const result = zodToJsonSchema(schema, 'RecordTest');
    const props = result.json_schema.schema.properties;

    expect(props.assignments).toBeDefined();
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/schemaUtils.test.ts
```
**Expect:** Module not found error

### Step 3: Implementation (Green)
**File:** `src/services/llm/schemaUtils.ts`
```typescript
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
export function zodToJsonSchema<T>(
  schema: z.ZodType<T>,
  schemaName: string
): JSONSchemaFormat {
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
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/schemaUtils.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/schemaUtils.ts src/services/llm/schemaUtils.test.ts
git commit -m "feat: add schemaUtils with Zod v4 native toJSONSchema"
```

---

## Task 4: Add callStructured Method to LLMApiClient

**Goal:** Add structured output call method with refusal handling

### Step 1: Write failing test
**File:** `src/services/llm/LLMApiClient.structured.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { z } from 'zod';
import { zodToJsonSchema } from './schemaUtils';

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

describe('LLMApiClient.callStructured', () => {
  let client: LLMApiClient;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger
    });
  });

  it('parses valid structured response', async () => {
    const TestSchema = z.object({
      message: z.string(),
      count: z.number().int()
    });

    const mockResponse = {
      choices: [{
        message: {
          content: '{"message":"hello","count":42}',
          refusal: null
        }
      }],
      model: 'gpt-4o-mini'
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    const result = await (client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    });

    expect(result).toEqual({ message: 'hello', count: 42 });
  });

  it('throws on refusal response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [{
        message: {
          content: null,
          refusal: 'Content policy violation'
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    await expect((client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    })).rejects.toThrow('LLM refused: Content policy violation');
  });

  it('throws on empty response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [{
        message: {
          content: null,
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    await expect((client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    })).rejects.toThrow('Empty response from LLM');
  });

  it('uses non-streaming mode for structured outputs', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [{
        message: { content: '{"value":"test"}', refusal: null }
      }]
    };

    const openai = await import('openai');
    const mockCreate = vi.mocked(openai.default).mock.instances[0].chat.completions.create;
    mockCreate.mockResolvedValue(mockResponse as any);

    await (client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: false,
        response_format: expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({
            strict: true
          })
        })
      }),
      expect.any(Object)
    );
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/LLMApiClient.structured.test.ts
```
**Expect:** "callStructured is not a function" error

### Step 3: Implementation (Green)

**First, add the interface export to LLMApiClient.ts:**

Find the existing export interface section (around line 15-30) and add after existing interfaces:

```typescript
export interface StructuredCallOptions<T> {
  prompt: LLMPrompt;
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}
```

**Then add the import at top of LLMApiClient.ts:**
```typescript
import { zodToJsonSchema, type StructuredCallOptions } from './schemaUtils';
```

**Then add the callStructured method to the LLMApiClient class (before the closing brace):**

```typescript
  /**
   * Call LLM with structured output enforcement.
   * Returns validated, typed result directly.
   *
   * @param options - Structured call options including prompt, schema, schema name
   * @returns Parsed and validated result matching the schema
   * @throws Error if LLM refuses or returns empty response
   */
  async callStructured<T>({
    prompt,
    schema,
    schemaName,
    signal,
  }: StructuredCallOptions<T>): Promise<T> {
    const requestBody: any = {
      model: this.options.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: false, // Structured outputs require non-streaming
      response_format: zodToJsonSchema(schema, schemaName),
    };

    // Apply provider-specific fixes
    applyProviderFixes(requestBody, this.provider);

    // Save request log
    if (this.debugLogger?.shouldLog('structured')) {
      this.debugLogger.saveLog('structured_request.json', requestBody);
    }

    this.logger?.info(`[structured] API call starting...`);

    // Make API call (non-streaming only for structured outputs)
    const response = await this.client.chat.completions.create(
      requestBody as any,
      { signal }
    );

    const message = response.choices[0]?.message;

    // Check for refusal (content policy triggers)
    if (message?.refusal) {
      throw new Error(`LLM refused: ${message.refusal}`);
    }

    const content = message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    this.logger?.info(`[structured] API call completed (${content.length} chars)`);

    // Save response log
    if (this.debugLogger?.shouldLog('structured')) {
      this.debugLogger.saveLog('structured_response.json', {
        choices: [{ message: { content } }],
        model: this.options.model,
      });
      this.debugLogger.markLogged('structured');
    }

    // Parse JSON and validate with Zod
    const parsed = JSON.parse(content);
    return schema.parse(parsed); // Zod runtime validation
  }
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/LLMApiClient.structured.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/LLMApiClient.ts src/services/llm/LLMApiClient.structured.test.ts
git commit -m "feat: add callStructured method with refusal handling"
```

---

## Task 5: Migrate Extract Stage to Structured Outputs

**Goal:** Replace extractCharacters to use callStructured

### Step 1: Write failing test
**File:** `src/services/llm/extract.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { LLMVoiceService } from './LLMVoiceService';
import { ExtractSchema } from './schemas';
import type { TextBlock } from '@/state/types';

describe('LLMVoiceService - Extract with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts characters using structured output', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: 'Found two speakers',
            characters: [
              { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
              { canonicalName: 'Bob', variations: ['Bob', 'Bobby'], gender: 'male' }
            ]
          }),
          refusal: null
        }
      }]
    };

    // Mock OpenAI
    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', '"Hi," replied Bob.']
    }];

    const result = await service.extractCharacters(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].canonicalName).toBe('Alice');
    expect(result[1].canonicalName).toBe('Bob');
  });

  it('handles null reasoning (transformed to undefined)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: null,
            characters: [
              { canonicalName: 'Narrator', variations: ['Narrator'], gender: 'unknown' }
            ]
          }),
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['The story begins.']
    }];

    const result = await service.extractCharacters(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe('Narrator');
  });

  it('throws on refusal during extract', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: null,
          refusal: 'Content policy violation'
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['Test content.']
    }];

    await expect(service.extractCharacters(blocks)).rejects.toThrow('LLM refused');
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/extract.test.ts
```
**Expect:** Tests fail because extractCharacters still uses old method

### Step 3: Implementation (Green)

**Modify src/services/llm/LLMVoiceService.ts:**

First, update imports at top of file:
```typescript
import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
```

Then, replace the `extractCharacters` method with:

```typescript
  /**
   * Extract: Extract characters from text blocks using structured outputs
   */
  async extractCharacters(
    blocks: TextBlock[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    this.logger?.info(`[Extract] Starting (${blocks.length} blocks)`);
    const allCharacters: LLMCharacter[] = [];
    this.abortController = new AbortController();
    this.apiClient.resetLogging();

    for (let i = 0; i < blocks.length; i++) {
      if (this.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      onProgress?.(i + 1, blocks.length);

      const block = blocks[i];
      const blockText = block.sentences.join('\n');

      const response = await this.apiClient.callStructured({
        prompt: buildExtractPrompt(blockText),
        schema: ExtractSchema,
        schemaName: 'ExtractSchema',
        signal: this.abortController.signal,
      });

      allCharacters.push(...response.characters);

      // Small delay between requests
      if (i < blocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    // Simple merge by canonicalName
    let merged = mergeCharacters(allCharacters);

    // LLM merge if multiple blocks and characters
    if (blocks.length > 1 && merged.length > 1) {
      onProgress?.(blocks.length, blocks.length, `Merging ${merged.length} characters...`);
      merged = await this.mergeCharactersWithLLM(merged, onProgress);
      onProgress?.(blocks.length, blocks.length, `Merged to ${merged.length} characters`);
    }

    return merged;
  }
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/extract.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/LLMVoiceService.ts src/services/llm/extract.test.ts
git commit -m "feat: migrate extract stage to structured outputs"
```

---

## Task 6: Migrate Merge Stage to Structured Outputs

**Goal:** Replace mergeCharactersWithLLM to use callStructured

### Step 1: Write failing test
**File:** `src/services/llm/merge.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { LLMVoiceService } from './LLMVoiceService';
import { MergeSchema } from './schemas';
import type { LLMCharacter } from '@/state/types';

describe('LLMVoiceService - Merge with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const testCharacters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice', 'Al'], gender: 'female' },
    { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges characters using structured output', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: 'Alice and Alicia are the same person',
            merges: [[0, 1]]  // Merge Alice (0) and Alicia (1)
          }),
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    // Access internal merge method via the public method
    const result = await (service as any).mergeCharactersWithLLM(testCharacters);

    // After merging 0 and 1, we should have 2 characters (Alice/Alicia merged, Bob separate)
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('handles empty merges (no duplicates)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: null,
            merges: []  // No merges needed
          }),
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger
    });

    const result = await (service as any).mergeCharactersWithLLM(testCharacters);

    // No merges means all characters remain
    expect(result).toHaveLength(testCharacters.length);
  });

  it('validates merge groups have 2+ indices', async () => {
    // Schema should reject single-element groups
    const result = MergeSchema.safeParse({
      reasoning: null,
      merges: [[0]]  // Invalid: single element
    });

    expect(result.success).toBe(false);
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/merge.test.ts
```
**Expect:** Tests fail due to old merge implementation

### Step 3: Implementation (Green)

**Modify src/services/llm/LLMVoiceService.ts:**

Replace the `singleMerge` method with:

```typescript
  /**
   * Single merge operation with specified temperature using structured outputs
   */
  private async singleMerge(
    characters: LLMCharacter[],
    temperature: number,
    onProgress?: ProgressCallback
  ): Promise<number[][] | null> {
    this.logger?.info(`[Merge] Single merge: ${characters.length} characters (temp=${temperature.toFixed(2)})`);

    const context: MergeContext = { characters };

    // Create a client with the specified temperature
    const client = new LLMApiClient({
      apiKey: this.options.mergeConfig?.apiKey ?? this.options.apiKey,
      apiUrl: this.options.mergeConfig?.apiUrl ?? this.options.apiUrl,
      model: this.options.mergeConfig?.model ?? this.options.model,
      streaming: false,  // Always non-streaming for structured outputs
      reasoning: this.options.mergeConfig?.reasoning ?? this.options.reasoning,
      temperature: temperature,
      topP: this.options.mergeConfig?.topP ?? this.options.topP,
      debugLogger: new DebugLogger(this.options.directoryHandle, this.logger),
      logger: this.logger,
    });

    try {
      const response = await client.callStructured({
        prompt: buildMergePrompt(context.characters),
        schema: MergeSchema,
        schemaName: 'MergeSchema',
        signal: this.abortController?.signal,
      });

      onRetry?.(0, 0, 'Merge validation passed');
      return response.merges;
    } catch (error) {
      this.logger?.warn(`[Merge] Vote failed (temp=${temperature.toFixed(2)}): ${(error as Error).message}`);
      return null;
    }
  }
```

Also update the `mergeCharactersWithLLM` method to remove the `validateMergeResponse` usage:

```typescript
  private async mergeCharactersWithLLM(
    characters: LLMCharacter[],
    onProgress?: ProgressCallback
  ): Promise<LLMCharacter[]> {
    const { mergeVoteCount } = defaultConfig.llm;

    if (characters.length <= 1) {
      return characters;
    }

    this.logger?.info(`[Merge] Starting ${mergeVoteCount}-way voting merge with ${characters.length} characters`);
    const votes: number[][][] = [];

    for (let i = 0; i < mergeVoteCount; i++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const temp = Math.round(Math.random() * 10) / 10;
      onProgress?.(i + 1, mergeVoteCount, `Merge vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)})...`);

      const mergeGroups = await this.singleMerge(characters, temp, onProgress);
      if (mergeGroups !== null) {
        votes.push(mergeGroups);
        this.logger?.info(`[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}): ${mergeGroups.length} merges`);
      } else {
        this.logger?.warn(`[Merge] Vote ${i + 1}/${mergeVoteCount} (temp=${temp.toFixed(2)}) failed, skipping`);
      }

      if (i < mergeVoteCount - 1) {
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
      }
    }

    if (votes.length === 0) {
      this.logger?.error(`[Merge] All ${mergeVoteCount} votes failed, returning original characters`);
      return characters;
    }

    const consensusGroups = buildMergeConsensus(votes, this.logger);
    this.logger?.info(`[Merge] Consensus: ${consensusGroups.length} merges from ${votes.length} votes`);

    const result = applyMergeGroups(characters, consensusGroups);
    this.logger?.info(`[Merge] Final: ${result.length} characters`);

    return result;
  }
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/merge.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/LLMVoiceService.ts src/services/llm/merge.test.ts
git commit -m "feat: migrate merge stage to structured outputs"
```

---

## Task 7: Migrate Assign Stage to Structured Outputs

**Goal:** Replace assignSpeakers to use callStructured with new sparse JSON format

### Step 1: Write failing test
**File:** `src/services/llm/assign.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { LLMVoiceService } from './LLMVoiceService';
import { AssignSchema } from './schemas';
import type { TextBlock } from '@/state/types';
import type { LLMCharacter } from '@/state/types';

describe('LLMVoiceService - Assign with Structured Outputs', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns speakers using structured output (sparse format)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: 'Assigning speakers to dialogue',
            assignments: {
              '0': 'Alice',
              '1': 'Bob'
            }
          }),
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', '"Hi," replied Bob.']
    }];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('handles sparse assignments (missing indices get narrator)', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            reasoning: null,
            assignments: {
              '0': 'Alice'  // Only sentence 0 assigned
            }
          }),
          refusal: null
        }
      }]
    };

    const openai = await import('openai');
    vi.mocked(openai.default).mock.instances[0].chat.completions.create
      .mockResolvedValue(mockResponse as any);

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      logger: mockLogger
    });

    const blocks: TextBlock[] = [{
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', 'This is narration.']
    }];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('narrator');  // Unassigned gets narrator
  });

  it('validates AssignSchema structure', () => {
    const validResult = AssignSchema.safeParse({
      reasoning: 'test',
      assignments: { '0': 'A', '5': 'B' }
    });
    expect(validResult.success).toBe(true);

    const invalidResult = AssignSchema.safeParse({
      reasoning: null,
      assignments: 'not an object'
    });
    expect(invalidResult.success).toBe(false);
  });
});
```

### Step 2: Run test (Red)
```bash
npm test src/services/llm/assign.test.ts
```
**Expect:** Tests fail - assign still uses line-based format

### Step 3: Implementation (Green)

**Modify src/services/llm/LLMVoiceService.ts:**

Replace the `processAssignBlock` method with:

```typescript
  /**
   * Process a single block for Assign using structured outputs
   * New format: sparse JSON object {"0": "A", "5": "B"}
   */
  private async processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>
  ): Promise<SpeakerAssignment[]> {
    this.logger?.debug(`[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`);

    const numberedParagraphs = block.sentences
      .map((s, i) => `[${i}] ${s}`)
      .join('\n');

    const context: AssignContext = {
      characters,
      nameToCode,
      codeToName,
      numberedParagraphs,
      sentenceCount: block.sentences.length,
    };

    const prompt = buildAssignPrompt(context.characters, context.nameToCode, context.numberedParagraphs);

    let relativeMap: Map<number, string>;

    if (this.options.useVoting) {
      // 3-way voting (implementation similar to original but with structured outputs)
      const responses: (object | null)[] = [];
      for (let i = 0; i < VOTING_TEMPERATURES.length; i++) {
        const client = new LLMApiClient({
          ...this.options,
          temperature: VOTING_TEMPERATURES[i],
        });

        try {
          const response = await client.callStructured({
            prompt,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal: this.abortController?.signal,
          });
          responses.push(response);
        } catch (e) {
          this.logger?.warn(`[assign] Vote ${i + 1} failed: ${(e as Error).message}`);
          responses.push(null);
        }

        if (i < VOTING_TEMPERATURES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));
        }
      }

      const validResponses = responses.filter((r): r is object => r !== null);
      if (validResponses.length === 0) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed (all votes), using narrator`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }

      // Parse valid responses and vote
      const parsedMaps = validResponses.map((r: any) => {
        const map = new Map<number, string>();
        for (const [key, code] of Object.entries(r.assignments)) {
          const idx = parseInt(key, 10);
          if (codeToName.has(code as string)) {
            map.set(idx, code as string);
          }
        }
        return map;
      });

      // Majority vote
      relativeMap = new Map();
      for (let i = 0; i < block.sentences.length; i++) {
        const votes = parsedMaps.map(m => m.get(i));
        const winner = majorityVote(votes, block.sentenceStartIndex + i);
        if (winner) relativeMap.set(i, winner);
      }
    } else {
      // Single call
      try {
        const response = await this.apiClient.callStructured({
          prompt,
          schema: AssignSchema,
          schemaName: 'AssignSchema',
          signal: this.abortController?.signal,
        });

        // Convert sparse object to Map
        relativeMap = new Map();
        for (const [key, code] of Object.entries(response.assignments)) {
          const index = parseInt(key, 10);
          if (context.codeToName.has(code)) {
            relativeMap.set(index, code);
          }
        }
      } catch (e) {
        this.logger?.warn(`[assign] Block at ${block.sentenceStartIndex} failed, using narrator`);
        return block.sentences.map((text, i) => ({
          sentenceIndex: block.sentenceStartIndex + i,
          text,
          speaker: 'narrator',
          voiceId: this.options.narratorVoice,
        }));
      }
    }

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const speaker = relativeMap.get(i) || 'narrator';
      return {
        sentenceIndex: absoluteIndex,
        text,
        speaker,
        voiceId: speaker === 'narrator'
          ? this.options.narratorVoice
          : characterVoiceMap.get(speaker) ?? this.options.narratorVoice,
      };
    });
  }
```

### Step 4: Verify (Green)
```bash
npm test src/services/llm/assign.test.ts
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/services/llm/LLMVoiceService.ts src/services/llm/assign.test.ts
git commit -m "feat: migrate assign stage to structured outputs (sparse JSON format)"
```

---

## Task 8: Remove Unused Imports and Code

**Goal:** Clean up LLMApiClient and PromptStrategy

### Step 1: Remove unused imports from LLMApiClient.ts

Remove these lines from imports:
```typescript
import { stripThinkingTags, extractJSON } from '@/utils/llmUtils';
```

### Step 2: Remove unused imports from PromptStrategy.ts

Remove these imports:
```typescript
import {
  validateExtractResponse as validateExtractResp,
  validateMergeResponse as validateMergeResp,
  validateAssignResponse as validateAssignResp,
  parseAssignResponse as parseAssignResponseInternal,
  parseMergeResponse as parseMergeResponseInternal,
  repairExtractCharacters,
  repairAssignResponse,
} from './ResponseValidators';
import { extractJSON } from '@/utils/llmUtils';
```

### Step 3: Simplify parsers in PromptStrategy.ts

Replace the parser functions with:

```typescript
// ============================================================================
// Response Parsing (simplified - no repair needed)
// ============================================================================

export function parseExtractResponse(response: unknown): ExtractResponse {
  return ExtractSchema.parse(response);
}

export function parseMergeResponse(response: unknown): MergeResponse {
  return MergeSchema.parse(response);
}

export function parseAssignResponse(response: unknown, context: AssignContext): AssignResult {
  const parsed = AssignSchema.parse(response);

  // Convert sparse object to Map
  const speakerMap = new Map<number, string>();
  for (const [key, code] of Object.entries(parsed.assignments)) {
    const index = parseInt(key, 10);
    if (context.codeToName.has(code)) {
      speakerMap.set(index, code);
    }
  }

  return { speakerMap };
}
```

Add the schema import:
```typescript
import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
```

### Step 4: Verify
```bash
npm run typecheck
```
**Expect:** PASS (no unused import errors)

### Step 5: Run tests
```bash
npm test
```
**Expect:** All existing tests still pass

### Step 6: Git commit
```bash
git add src/services/llm/LLMApiClient.ts src/services/llm/PromptStrategy.ts
git commit -m "refactor: remove unused imports and simplify parsers"
```

---

## Task 9: Delete Obsolete Files

**Goal:** Remove files no longer needed

### Step 1: Delete llmUtils.ts
```bash
rm src/utils/llmUtils.ts
```

### Step 2: Delete ResponseValidators.ts
```bash
rm src/services/llm/ResponseValidators.ts
rm src/services/llm/ResponseValidators.test.ts
```

### Step 3: Verify
```bash
npm run typecheck
```
**Expect:** May have errors if any files still reference deleted functions

### Step 4: Fix any remaining references

Search for any remaining references:
```bash
grep -r "stripThinkingTags\|extractJSON\|validateExtractResponse\|validateMergeResponse\|validateAssignResponse\|repairExtractCharacters\|repairMergeResponse\|repairAssignResponse" src/ --exclude-dir=node_modules
```

### Step 5: Run all tests
```bash
npm test
```
**Expect:** PASS

### Step 6: Git commit
```bash
git add -A
git commit -m "refactor: delete obsolete llmUtils and ResponseValidators"
```

---

## Task 10: Update Prompts for Structured Outputs

**Goal:** Update prompt templates to reference new schema format

### Step 1: Update Extract prompt

**File:** `src/config/prompts/index.ts`

Find the extract prompt and update to mention JSON output:

```typescript
export const LLM_PROMPTS = {
  extract: {
    system: `You are a character extraction assistant. Extract all speaking characters from the text.

Return a JSON object with this exact structure:
{
  "reasoning": "Brief explanation of your analysis (or null if none)",
  "characters": [
    {
      "canonicalName": "Character's primary name",
      "variations": ["array of name variations"],
      "gender": "male" | "female" | "unknown"
    }
  ]
}

Rules:
- canonicalName must be non-empty
- variations must include at least the canonicalName
- gender must be one of: male, female, unknown
- Return null for reasoning if no additional explanation needed`,
    userTemplate: 'Text:\n{{text}}\n\nExtract characters:'
  },
  // ... other prompts
};
```

### Step 2: Update Merge prompt

```typescript
merge: {
  system: `You are a character merge assistant. Identify which characters are the same person under different names.

Return a JSON object with this exact structure:
{
  "reasoning": "Brief explanation of merge decisions (or null if none)",
  "merges": [[index1, index2, ...], ...]
}

Rules:
- Each merge group must have 2 or more indices
- Indices are 0-based (0 to N-1 for N characters)
- Only merge characters that are clearly the same person
- Return empty array [] if no merges are needed`,
  userTemplate: 'Characters:\n{{characters}}\n\nIdentify duplicates to merge:'
},
```

### Step 3: Update Assign prompt

```typescript
assign: {
  system: `You are a speaker assignment assistant. Assign each sentence to a character or narrator.

Return a JSON object with this exact structure:
{
  "reasoning": "Brief explanation of assignments (or null if straightforward)",
  "assignments": {"0": "CODE", "5": "CODE", ...}
}

Rules:
- Keys are sentence indices as strings (0-based)
- Values are character codes (e.g., "A", "B", "C")
- Only include indices where a specific character speaks
- Omit indices that are narration (they will default to narrator)
- {{characterLines}}

Characters:
{{characterLines}}`,
  userTemplate: 'Sentences:\n{{paragraphs}}\n\nAssign speakers:'
},
```

### Step 4: Verify
```bash
npm test src/config/prompts/
```
**Expect:** PASS

### Step 5: Git commit
```bash
git add src/config/prompts/
git commit -m "docs: update prompts for structured outputs format"
```

---

## Task 11: Final Integration Testing

**Goal:** Run full test suite and verify everything works

### Step 1: Run all tests
```bash
npm test
```
**Expect:** All tests pass

### Step 2: Type check
```bash
npm run typecheck
```
**Expect:** No errors

### Step 3: Build check
```bash
npm run build
```
**Expect:** Successful build

### Step 4: Code coverage
```bash
npm run test:coverage
```
**Verify:** Coverage for new schemas and schemaUtils is adequate

### Step 5: Final commit
```bash
git add -A
git commit -m "test: verify structured outputs refactor complete"
```

---

## Verification Checklist

After completing all tasks:

- [ ] Zod v4 installed, jsonrepair removed
- [ ] All schemas defined and tested
- [ ] `zodToJsonSchema` uses native Zod method with `target: 'draft-7'`
- [ ] `callStructured` method handles refusals
- [ ] Extract stage uses structured outputs
- [ ] Merge stage uses structured outputs
- [ ] Assign stage uses structured outputs (sparse JSON format)
- [ ] `llmUtils.ts` deleted
- [ ] `ResponseValidators.ts` and test deleted
- [ ] Prompts updated for new format
- [ ] All tests pass
- [ ] Type check passes
- [ ] Build succeeds

---

## Expected Final State

**Files deleted:** 3
- `src/utils/llmUtils.ts` (~40 lines)
- `src/services/llm/ResponseValidators.ts` (~350 lines)
- `src/services/llm/ResponseValidators.test.ts` (~250 lines)

**Files created:** 5
- `src/services/llm/schemas.ts` (~40 lines)
- `src/services/llm/schemas.test.ts` (~100 lines)
- `src/services/llm/schemaUtils.ts` (~30 lines)
- `src/services/llm/schemaUtils.test.ts` (~60 lines)
- `src/services/llm/LLMApiClient.structured.test.ts` (~80 lines)

**Net reduction:** ~400 lines (60% in LLM handling code)
