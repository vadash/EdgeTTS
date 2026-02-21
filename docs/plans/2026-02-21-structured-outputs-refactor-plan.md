# Implementation Plan - Structured Outputs Refactor

> **Reference:** `docs/designs/2026-02-21-structured-outputs-refactor-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

Refactor all 3 LLM stages (Extract, Merge, Assign) to use OpenAI Structured Outputs with `json_schema` format. Eliminates ~360 lines of repair/validation code (54% reduction).

**Estimated time:** 2-3 hours
**Dependencies:** `zod`, `zod-to-json-schema`

---

## Task 1: Install Dependencies

**Goal:** Add Zod for schema validation and zod-to-json-schema for conversion.

**Step 1: Install zod and zod-to-json-schema**
```bash
npm install zod zod-to-json-schema
```

**Step 2: Uninstall jsonrepair (no longer needed)**
```bash
npm uninstall jsonrepair
```

**Step 3: Verify dependencies**
```bash
npm run typecheck
```

**Step 4: Git commit**
```bash
git add package.json package-lock.json
git commit -m "deps: add zod, zod-to-json-schema; remove jsonrepair"
```

---

## Task 2: Create Zod Schemas

**Goal:** Define type-safe schemas for all 3 stages.

**Step 1: Write the failing test**
- File: `src/services/llm/schemas.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';

  describe('ExtractSchema', () => {
    it('validates correct extract response', () => {
      const input = {
        reasoning: 'Some reasoning',
        characters: [
          { canonicalName: 'John', variations: ['John', 'Johnny'], gender: 'male' }
        ]
      };
      const result = ExtractSchema.parse(input);
      expect(result.characters).toHaveLength(1);
    });

    it('rejects response without characters', () => {
      const input = { reasoning: 'test' };
      expect(() => ExtractSchema.parse(input)).toThrow();
    });

    it('rejects invalid gender', () => {
      const input = {
        characters: [
          { canonicalName: 'John', variations: ['John'], gender: 'invalid' }
        ]
      };
      expect(() => ExtractSchema.parse(input)).toThrow();
    });

    it('accepts response without reasoning field', () => {
      const input = {
        characters: [
          { canonicalName: 'Jane', variations: ['Jane'], gender: 'female' }
        ]
      };
      const result = ExtractSchema.parse(input);
      expect(result.reasoning).toBeUndefined();
    });
  });

  describe('MergeSchema', () => {
    it('validates correct merge response', () => {
      const input = {
        merges: [[0, 1], [2, 3, 4]]
      };
      const result = MergeSchema.parse(input);
      expect(result.merges).toHaveLength(2);
    });

    it('rejects single-element groups', () => {
      const input = { merges: [[0]] };
      expect(() => MergeSchema.parse(input)).toThrow();
    });

    it('rejects negative indices', () => {
      const input = { merges: [[-1, 0]] };
      expect(() => MergeSchema.parse(input)).toThrow();
    });
  });

  describe('AssignSchema', () => {
    it('validates correct assign response', () => {
      const input = {
        reasoning: 'test',
        assignments: { '0': 'A', '5': 'B', '12': 'C' }
      };
      const result = AssignSchema.parse(input);
      expect(result.assignments['0']).toBe('A');
    });

    it('accepts sparse assignments', () => {
      const input = {
        assignments: { '0': 'A', '100': 'B' }
      };
      const result = AssignSchema.parse(input);
      expect(Object.keys(result.assignments)).toHaveLength(2);
    });

    it('accepts response without reasoning', () => {
      const input = { assignments: { '0': 'A' } };
      const result = AssignSchema.parse(input);
      expect(result.reasoning).toBeUndefined();
    });
  });
  ```

**Step 2: Run test (Red)**
```bash
npm test
```
Expect: "Error: Cannot find module './schemas'"

**Step 3: Implementation (Green)**
- File: `src/services/llm/schemas.ts`
- Action: Create the file with this exact content:
  ```typescript
  import { z } from 'zod';

  /**
   * Zod schemas for LLM Structured Outputs
   * All schemas include optional 'reasoning' field to preserve reasoning quality
   */

  // Character schema for Extract stage
  export const ExtractCharacterSchema = z.object({
    canonicalName: z.string().min(1, 'canonicalName must not be empty'),
    variations: z.array(z.string()).min(1, 'variations must have at least one entry'),
    gender: z.enum(['male', 'female', 'unknown'], {
      errorMap: () => ({ message: 'gender must be male, female, or unknown' })
    }),
  });

  // Extract stage schema
  export const ExtractSchema = z.object({
    reasoning: z.string().optional(),
    characters: z.array(ExtractCharacterSchema).min(1, 'must have at least one character'),
  });

  // Merge stage schema
  export const MergeSchema = z.object({
    reasoning: z.string().optional(),
    merges: z.array(
      z.array(z.number().int().min(0, 'indices must be non-negative integers')).min(2, 'merge groups must have at least 2 indices')
    ),
  });

  // Assign stage schema (sparse format: {"0": "A", "5": "B"})
  export const AssignSchema = z.object({
    reasoning: z.string().optional(),
    assignments: z.record(z.string().min(1, 'speaker code must not be empty')),
  });

  // Type exports
  export type ExtractResponse = z.infer<typeof ExtractSchema>;
  export type MergeResponse = z.infer<typeof MergeSchema>;
  export type AssignResponse = z.infer<typeof AssignSchema>;
  ```

**Step 4: Verify (Green)**
```bash
npm test src/services/llm/schemas.test.ts
```
Expect: PASS

**Step 5: Git commit**
```bash
git add src/services/llm/schemas.ts src/services/llm/schemas.test.ts
git commit -m "feat: add Zod schemas for structured outputs"
```

---

## Task 3: Create Schema Utilities

**Goal:** Utility to convert Zod schemas to OpenAI-compatible JSON Schema format.

**Step 1: Write the failing test**
- File: `src/services/llm/schemaUtils.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { zodToJsonSchema } from './schemaUtils';
  import { z } from 'zod';

  describe('zodToJsonSchema', () => {
    it('converts simple zod schema to OpenAI format', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });
      const result = zodToJsonSchema(schema, 'TestSchema');

      expect(result.type).toBe('json_schema');
      expect(result.json_schema.name).toBe('TestSchema');
      expect(result.json_schema.strict).toBe(true);
      expect(result.json_schema.schema).toHaveProperty('type', 'object');
    });

    it('includes required fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });
      const result = zodToJsonSchema(schema, 'TestSchema');
      const props = result.json_schema.schema.properties as any;

      expect(props.required).toBeDefined();
      expect(props.optional).toBeDefined();
    });

    it('handles enum constraints', () => {
      const schema = z.object({
        gender: z.enum(['male', 'female', 'unknown']),
      });
      const result = zodToJsonSchema(schema, 'TestSchema');
      const props = result.json_schema.schema.properties as any;

      expect(props.gender).toHaveProperty('enum');
    });

    it('handles nested objects and arrays', () => {
      const schema = z.object({
        items: z.array(z.object({ name: z.string() })),
      });
      const result = zodToJsonSchema(schema, 'TestSchema');
      const props = result.json_schema.schema.properties as any;

      expect(props.items).toHaveProperty('type', 'array');
    });
  });
  ```

**Step 2: Run test (Red)**
```bash
npm test
```
Expect: "Cannot find module './schemaUtils'"

**Step 3: Implementation (Green)**
- File: `src/services/llm/schemaUtils.ts`
- Action: Create with this content:
  ```typescript
  import { z } from 'zod';
  import { zodToJsonSchema as zodConvert } from 'zod-to-json-schema';

  /**
   * OpenAI Structured Outputs format
   */
  export interface OpenAIJsonSchema {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  }

  /**
   * Convert Zod schema to OpenAI-compatible JSON Schema format.
   * Sets strict: true for constrained decoding.
   */
  export function zodToJsonSchema(
    schema: z.ZodType,
    schemaName: string
  ): OpenAIJsonSchema {
    // Use zod-to-json-schema library for accurate conversion
    const jsonSchema = zodConvert(schema, {
      name: schemaName,
      target: 'openAi',
    }) as Record<string, unknown>;

    return {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema: jsonSchema,
      },
    };
  }

  /**
   * Extract the reasoning field from a structured response.
   * Returns undefined if reasoning field is not present.
   */
  export function extractReasoning(response: unknown): string | undefined {
    if (typeof response === 'object' && response !== null && 'reasoning' in response) {
      const reasoning = (response as any).reasoning;
      return typeof reasoning === 'string' ? reasoning : undefined;
    }
    return undefined;
  }
  ```

**Step 4: Verify (Green)**
```bash
npm test src/services/llm/schemaUtils.test.ts
```
Expect: PASS

**Step 5: Git commit**
```bash
git add src/services/llm/schemaUtils.ts src/services/llm/schemaUtils.test.ts
git commit -m "feat: add Zod to JSON Schema conversion utilities"
```

---

## Task 4: Add callStructured to LLMApiClient

**Goal:** Add new method that uses structured outputs instead of raw responses.

**Step 1: Write the failing test**
- File: `src/services/llm/LLMApiClient.structured.test.ts`
- Code:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { LLMApiClient } from './LLMApiClient';
  import { z } from 'zod';
  import { zodToJsonSchema } from './schemaUtils';

  // Simple schema for testing
  const TestSchema = z.object({
    answer: z.string(),
  });

  describe('LLMApiClient.callStructured', () => {
    let client: LLMApiClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.test.com/v1',
        model: 'test-model',
      });
    });

    it('adds response_format to request body', async () => {
      const prompt = { system: 'You are helpful', user: 'Say hello' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: JSON.stringify({ answer: 'hello' }) }
          }]
        }),
      });

      await client.callStructured({
        prompt,
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'TestSchema',
          strict: true,
          schema: expect.any(Object),
        },
      });
    });

    it('sets stream to false (required for structured outputs)', async () => {
      const prompt = { system: 'You are helpful', user: 'Say hello' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: JSON.stringify({ answer: 'hello' }) }
          }]
        }),
      });

      await client.callStructured({
        prompt,
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.stream).toBe(false);
    });

    it('validates response with Zod schema', async () => {
      const prompt = { system: 'You are helpful', user: 'Say hello' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: JSON.stringify({ answer: 'hello' }) }
          }]
        }),
      });

      const result = await client.callStructured({
        prompt,
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      expect(result).toEqual({ answer: 'hello' });
    });

    it('throws on Zod validation failure', async () => {
      const prompt = { system: 'You are helpful', user: 'Say hello' };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: JSON.stringify({ wrong: 'field' }) }
          }]
        }),
      });

      await expect(client.callStructured({
        prompt,
        schema: TestSchema,
        schemaName: 'TestSchema',
      })).rejects.toThrow();
    });

    it('respects abort signal', async () => {
      const prompt = { system: 'You are helpful', user: 'Say hello' };
      const controller = new AbortController();
      controller.abort();

      await expect(client.callStructured({
        prompt,
        schema: TestSchema,
        schemaName: 'TestSchema',
        signal: controller.signal,
      })).rejects.toThrow();
    });
  });
  ```

**Step 2: Run test (Red)**
```bash
npm test
```
Expect: "callStructured is not a function"

**Step 3: Implementation (Green)**
- File: `src/services/llm/LLMApiClient.ts`
- Action: Add the following after the `call` private method (around line 230):

  ```typescript
  /**
   * Call LLM with structured output enforcement.
   * Returns validated, typed result directly.
   *
   * This method uses OpenAI's Structured Outputs feature which guarantees
   * the response matches the provided schema at the decoding layer.
   *
   * @param options - Call options including prompt, Zod schema, and abort signal
   * @returns Parsed and validated response matching the schema
   */
  async callStructured<T>({
    prompt,
    schema,
    schemaName,
    signal,
  }: {
    prompt: LLMPrompt;
    schema: z.ZodType<T>;
    schemaName: string;
    signal?: AbortSignal;
  }): Promise<T> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];

    // Build request body
    const requestBody: any = {
      model: this.options.model,
      messages,
      stream: false, // Structured outputs require non-streaming
      response_format: zodToJsonSchema(schema, schemaName),
      max_tokens: defaultConfig.llm.maxTokens,
    };

    // Handle Reasoning vs Standard models
    if (this.options.reasoning) {
      requestBody.reasoning_effort = this.options.reasoning;
      // Reasoning models crash if you send temperature or top_p
    } else {
      requestBody.temperature = this.options.temperature ?? 0.0;
      requestBody.top_p = this.options.topP ?? 0.95;
    }

    // Apply provider-specific fixes
    applyProviderFixes(requestBody, this.provider);

    // Save request log
    if (this.debugLogger?.shouldLog(schemaName.toLowerCase() as PassType)) {
      this.debugLogger.saveLog(`${schemaName.toLowerCase()}_request.json`, requestBody);
    }

    this.logger?.info(`[${schemaName}] API call starting... (structured output)`);

    // Make API call (non-streaming)
    let content = '';
    try {
      const response = await this.client.chat.completions.create(requestBody as any, { signal });
      content = response.choices[0]?.message?.content || '';
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        throw new Error('Operation cancelled');
      }
      throw error;
    }

    this.logger?.info(`[${schemaName}] API call completed (${content.length} chars)`);

    // Save response log
    if (this.debugLogger?.shouldLog(schemaName.toLowerCase() as PassType)) {
      const data = {
        choices: [{ message: { content } }],
        model: this.options.model,
      };
      this.debugLogger.saveLog(`${schemaName.toLowerCase()}_response.json`, data);
      this.debugLogger.markLogged(schemaName.toLowerCase() as PassType);
    }

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Parse and validate with Zod
    try {
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    } catch (error: any) {
      this.logger?.error(`[${schemaName}] Schema validation failed`, error);
      throw new Error(`Structured output validation failed: ${error.message}`);
    }
  }
  ```

- Also add import at top:
  ```typescript
  import { z } from 'zod';
  import { zodToJsonSchema } from './schemaUtils';
  ```

**Step 4: Verify (Green)**
```bash
npm test src/services/llm/LLMApiClient.structured.test.ts
```
Expect: PASS

**Step 5: Git commit**
```bash
git add src/services/llm/LLMApiClient.ts src/services/llm/LLMApiClient.structured.test.ts
git commit -m "feat: add callStructured method for structured outputs"
```

---

## Task 5: Migrate Extract Stage

**Goal:** Use callStructured for Extract stage, remove old validation logic.

**Step 1: Update LLMVoiceService.extractCharacters**
- File: `src/services/llm/LLMVoiceService.ts`
- Find the `extractCharacters` method and replace it with:
  ```typescript
  async extractCharacters(textBlock: string): Promise<LLMCharacter[]> {
    const prompt = buildExtractPrompt(textBlock);
    const response = await this.llm.callStructured({
      prompt,
      schema: ExtractSchema,
      schemaName: 'ExtractSchema',
      signal: this.signal,
    });
    return response.characters;
  }
  ```

**Step 2: Remove import of validators**
- File: `src/services/llm/LLMVoiceService.ts`
- Remove this import (if present):
  ```typescript
  import { validateExtractResponse } from './ResponseValidators';
  ```

**Step 3: Add schema import**
- File: `src/services/llm/LLMVoiceService.ts`
- Add:
  ```typescript
  import { ExtractSchema } from './schemas';
  ```

**Step 4: Verify**
```bash
npm run typecheck
```

**Step 5: Git commit**
```bash
git add src/services/llm/LLMVoiceService.ts
git commit -m "refactor: migrate Extract stage to structured outputs"
```

---

## Task 6: Migrate Merge Stage

**Goal:** Use callStructured for Merge stage.

**Step 1: Update LLMVoiceService.mergeCharactersWithLLM**
- File: `src/services/llm/LLMVoiceService.ts`
- Find the `mergeCharactersWithLLM` method and replace with:
  ```typescript
  async mergeCharactersWithLLM(characters: LLMCharacter[]): Promise<number[][]> {
    const prompt = buildMergePrompt(characters);
    const response = await this.llm.callStructured({
      prompt,
      schema: MergeSchema,
      schemaName: 'MergeSchema',
      signal: this.signal,
    });
    return response.merges;
  }
  ```

**Step 2: Remove import of validators**
- File: `src/services/llm/LLMVoiceService.ts`
- Remove this import:
  ```typescript
  import { validateMergeResponse } from './ResponseValidators';
  ```

**Step 3: Add schema import**
- File: `src/services/llm/LLMVoiceService.ts`
- Add to existing schema import:
  ```typescript
  import { ExtractSchema, MergeSchema } from './schemas';
  ```

**Step 4: Verify**
```bash
npm run typecheck
```

**Step 5: Git commit**
```bash
git add src/services/llm/LLMVoiceService.ts
git commit -m "refactor: migrate Merge stage to structured outputs"
```

---

## Task 7: Migrate Assign Stage

**Goal:** Use callStructured for Assign stage with sparse JSON format.

**Step 1: Update buildAssignPrompt**
- File: `src/services/llm/PromptStrategy.ts`
- Update `buildAssignPrompt` to mention JSON format:
  - In the prompt, change references from `index:CODE` line format to JSON format
  - The prompt should say: "Return a JSON object with an 'assignments' key containing sparse indices as keys..."

**Step 2: Update LLMVoiceService.assignSpeakers**
- File: `src/services/llm/LLMVoiceService.ts`
- Find the `assignSpeakers` method and replace with:
  ```typescript
  async assignSpeakers(
    paragraphs: readonly Paragraph[],
    characters: LLMCharacter[]
  ): Promise<Map<number, string>> {
    const nameToCode = buildCodeMapping(characters);
    const codeToName = invertMap(nameToCode);

    const numberedParagraphs = buildNumberedParagraphs(paragraphs);
    const sentenceCount = countSentences(paragraphs);

    const prompt = buildAssignPrompt(characters, nameToCode, numberedParagraphs);

    const response = await this.llm.callStructured({
      prompt,
      schema: AssignSchema,
      schemaName: 'AssignSchema',
      signal: this.signal,
    });

    // Convert sparse assignments to Map
    const speakerMap = new Map<number, string>();
    for (const [key, code] of Object.entries(response.assignments)) {
      const index = parseInt(key, 10);
      const name = codeToName.get(code);
      if (name !== undefined) {
        speakerMap.set(index, name);
      }
    }

    return speakerMap;
  }

  function invertMap<K, V>(map: Map<K, V>): Map<V, K> {
    const inverted = new Map<V, K>();
    for (const [key, value] of map.entries()) {
      inverted.set(value, key);
    }
    return inverted;
  }

  function buildNumberedParagraphs(paragraphs: readonly Paragraph[]): string {
    return paragraphs.map((p, i) => `[${i}] ${p.text}`).join('\n\n');
  }

  function countSentences(paragraphs: readonly Paragraph[]): number {
    return paragraphs.reduce((sum, p) => sum + p.sentences.length, 0);
  }
  ```

**Step 3: Remove import of validators**
- File: `src/services/llm/LLMVoiceService.ts`
- Remove this import:
  ```typescript
  import { validateAssignResponse } from './ResponseValidators';
  ```

**Step 4: Add schema import**
- File: `src/services/llm/LLMVoiceService.ts`
- Add to schema imports:
  ```typescript
  import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
  ```

**Step 5: Update prompt templates**
- File: `src/config/prompts/assign.ts`
- Update system prompt to specify JSON output format:
  ```typescript
  export const assign = {
    system: `You are a speaker assignment expert. Your task is to identify which character is speaking each line of dialogue.

  Output Format:
  Return a JSON object with this structure:
  {
    "reasoning": "Brief explanation of your reasoning (optional)",
    "assignments": {
      "0": "CODE",
      "5": "CODE",
      "12": "CODE"
    }
  }

  - The "assignments" object should only include indices where dialogue occurs (sparse format)
  - Use the speaker CODE provided in the character list
  - Indices correspond to the numbered paragraph indices

  ...rest of instructions...`,
    // ... rest of template
  };
  ```

**Step 6: Verify**
```bash
npm run typecheck
```

**Step 7: Git commit**
```bash
git add src/services/llm/LLMVoiceService.ts src/config/prompts/assign.ts
git commit -m "refactor: migrate Assign stage to structured outputs"
```

---

## Task 8: Simplify PromptStrategy

**Goal:** Remove validator imports and simplify parsers.

**Step 1: Remove validator imports**
- File: `src/services/llm/PromptStrategy.ts`
- Remove these imports:
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

**Step 2: Simplify parseExtractResponse**
- Replace with:
  ```typescript
  export function parseExtractResponse(response: unknown): ExtractResponse {
    return ExtractSchema.parse(response);
  }
  ```

**Step 3: Simplify parseMergeResponse**
- Replace with:
  ```typescript
  export function parseMergeResponse(response: unknown): number[][] {
    const parsed = MergeSchema.parse(response as any);
    return parsed.merges;
  }
  ```

**Step 4: Simplify parseAssignResponse**
- Replace with:
  ```typescript
  export function parseAssignResponse(
    response: unknown,
    context: AssignContext
  ): AssignResult {
    const parsed = AssignSchema.parse(response);
    const speakerMap = new Map<number, string>();

    for (const [key, code] of Object.entries(parsed.assignments)) {
      const index = parseInt(key, 10);
      const name = context.codeToName.get(code);
      if (name) {
        speakerMap.set(index, name);
      }
    }

    return { speakerMap };
  }
  ```

**Step 5: Add schema imports**
- Add at top:
  ```typescript
  import { ExtractSchema, MergeSchema, AssignSchema } from './schemas';
  ```

**Step 6: Verify**
```bash
npm test src/services/llm/PromptStrategy.test.ts
npm run typecheck
```

**Step 7: Git commit**
```bash
git add src/services/llm/PromptStrategy.ts
git commit -m "refactor: simplify PromptStrategy parsers with Zod"
```

---

## Task 9: Delete Obsolete Files

**Goal:** Remove files that are no longer needed.

**Step 1: Delete llmUtils.ts**
```bash
rm src/utils/llmUtils.ts
```

**Step 2: Delete ResponseValidators.ts**
```bash
rm src/services/llm/ResponseValidators.ts
rm src/services/llm/ResponseValidators.test.ts
```

**Step 3: Update any remaining imports**
- Run:
```bash
npm run typecheck
```
- Fix any remaining import errors

**Step 4: Git commit**
```bash
git add -A
git commit -m "refactor: remove obsolete llmUtils and ResponseValidators"
```

---

## Task 10: Update Prompts for New Format

**Goal:** Ensure prompts reference JSON output format.

**Step 1: Update extract.ts prompt**
- File: `src/config/prompts/extract.ts`
- Ensure system prompt mentions:
  ```typescript
  Output Format:
  Return a JSON object with this structure:
  {
    "reasoning": "Brief explanation (optional)",
    "characters": [
      {
        "canonicalName": "Full Name",
        "variations": ["Name", "Variation1", "Variation2"],
        "gender": "male" | "female" | "unknown"
      }
    ]
  }
  ```

**Step 2: Update merge.ts prompt**
- File: `src/config/prompts/merge.ts`
- Ensure system prompt mentions:
  ```typescript
  Output Format:
  Return a JSON object with this structure:
  {
    "reasoning": "Brief explanation (optional)",
    "merges": [[0, 1], [2, 3, 4]]
  }
  ```

**Step 3: Verify**
```bash
npm run typecheck
```

**Step 4: Git commit**
```bash
git add src/config/prompts/
git commit -m "docs: update prompts for structured output format"
```

---

## Task 11: Final Verification

**Goal:** Ensure everything compiles and tests pass.

**Step 1: Type check**
```bash
npm run typecheck
```
Expect: No errors

**Step 2: Run unit tests**
```bash
npm test
```
Expect: All tests pass

**Step 3: Run real LLM tests (if API keys available)**
```bash
npm run test:real
```
Expect: Tests pass (may fail if no API keys configured)

**Step 4: Build**
```bash
npm run build
```
Expect: Successful build

**Step 5: Git commit**
```bash
git add -A
git commit -m "refactor: complete structured outputs migration"
```

---

## Verification Checklist

After completion, verify:
- [ ] `src/utils/llmUtils.ts` deleted
- [ ] `src/services/llm/ResponseValidators.ts` deleted
- [ ] `src/services/llm/ResponseValidators.test.ts` deleted
- [ ] `src/services/llm/schemas.ts` created
- [ ] `src/services/llm/schemaUtils.ts` created
- [ ] All 3 stages use `callStructured`
- [ ] No imports of deleted files remain
- [ ] `jsonrepair` removed from dependencies
- [ ] `zod` and `zod-to-json-schema` in dependencies
- [ ] All tests pass
- [ ] Build succeeds

## Code Reduction Verification

Count lines before and after:
```bash
# Before (from git history)
git show HEAD~10:src/services/llm/ResponseValidators.ts | wc -l
git show HEAD~10:src/utils/llmUtils.ts | wc -l

# After
wc -l src/services/llm/schemas.ts src/services/llm/schemaUtils.ts
```

Expected net reduction: ~360 lines (54%)
