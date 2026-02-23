# Implementation Plan - Streaming Structured Outputs (SSE)

> **Reference:** `docs/designs/2026-02-23-streaming-structured-outputs-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Extract shared post-processing into helper

**Goal:** Extract JSON parsing + fence stripping + Zod validation into a reusable function so both streaming and non-streaming paths share it.

**Step 1: Write the Failing Test**
- File: `src/services/llm/LLMApiClient.structured.test.ts`
- Code: Add test at the end of the describe block:
  ```typescript
  it('strips markdown fences from response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [{
        message: { content: '```json\n{"value":"fenced"}\n```', refusal: null }
      }]
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger
    });

    const result = await (client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    });

    expect(result).toEqual({ value: 'fenced' });
  });
  ```

**Step 2: Run Test (Red → should be Green already)**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: PASS (this test validates existing behavior before refactoring)

**Step 3: Implementation (Refactor)**
- File: `src/services/llm/LLMApiClient.ts`
- Action: Extract a private method `parseStructuredResponse<T>(content: string, schema: z.ZodType<T>): T` that contains:
  1. Trim content
  2. Strip markdown fences (`/^```(?:json)?\s*([\s\S]*?)\s*```$/i`)
  3. `JSON.parse()`
  4. `schema.parse()` wrapped in try/catch → `RetriableError`
- Replace the inline code in `callStructured()` (lines ~301-316) with a call to `this.parseStructuredResponse(content, schema)`

  ```typescript
  /**
   * Parse JSON content and validate with Zod schema.
   * Shared by both streaming and non-streaming paths.
   */
  private parseStructuredResponse<T>(content: string, schema: z.ZodType<T>): T {
    let jsonContent = content.trim();
    const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) jsonContent = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonContent);

    try {
      return schema.parse(parsed);
    } catch (error) {
      throw new RetriableError(
        `Zod validation failed: ${(error as Error).message}`,
        error as Error
      );
    }
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: All tests PASS (no behavior change, just refactor)

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: extract parseStructuredResponse helper in LLMApiClient"`

---

### Task 2: Add streaming path to callStructured

**Goal:** When `this.options.streaming` is true, use `stream: true` and accumulate chunks before parsing.

**Step 1: Write the Failing Test**
- File: `src/services/llm/LLMApiClient.structured.test.ts`
- Code: Add test:
  ```typescript
  it('streams structured response when streaming enabled', async () => {
    const TestSchema = z.object({ value: z.string() });

    // Mock async iterable stream
    const chunks = [
      { choices: [{ delta: { content: '{"val' }, finish_reason: null }], model: 'gpt-4o-mini' },
      { choices: [{ delta: { content: 'ue":"str' }, finish_reason: null }], model: 'gpt-4o-mini' },
      { choices: [{ delta: { content: 'eamed"}' }, finish_reason: 'stop' }], model: 'gpt-4o-mini' },
    ];

    const asyncIterable = {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () => i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true }
        };
      }
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger
    });

    const result = await (client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    });

    expect(result).toEqual({ value: 'streamed' });

    // Verify stream: true was passed
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      expect.any(Object)
    );
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: FAIL — `callStructured` currently hardcodes `stream: false`, so `mockCreate` receives `stream: false` and the response object doesn't have async iterator behavior handled.

**Step 3: Implementation (Green)**
- File: `src/services/llm/LLMApiClient.ts`
- Action: In `callStructured()`, replace the hardcoded `stream: false` and non-streaming API call with a conditional branch:

  ```typescript
  async callStructured<T>({
    prompt,
    schema,
    schemaName,
    signal,
  }: StructuredCallOptions<T>): Promise<T> {
    const useStreaming = this.options.streaming ?? false;

    const requestBody: any = {
      model: this.options.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: useStreaming,
      response_format: zodToJsonSchema(schema, schemaName),
    };

    applyProviderFixes(requestBody, this.provider);

    if (this.debugLogger?.shouldLog('structured')) {
      this.debugLogger.saveLog('structured_request.json', requestBody);
    }

    this.logger?.info(`[structured] API call starting (streaming: ${useStreaming})...`);

    let content: string;

    if (useStreaming) {
      // Streaming path: accumulate SSE chunks
      const stream = await this.client.chat.completions.create(
        requestBody as any,
        { signal }
      );

      let accumulated = '';
      let finishReason: string | null = null;

      for await (const chunk of stream as any) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          accumulated += delta.content;
        }
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      if (finishReason === 'content_filter') {
        throw new Error('Response refused by content filter');
      }

      if (!accumulated) {
        throw new Error('Empty response from LLM');
      }

      content = accumulated;
    } else {
      // Non-streaming path (existing behavior)
      const response = await this.client.chat.completions.create(
        requestBody as any,
        { signal }
      );

      const message = (response as any).choices[0]?.message;

      if (message?.refusal) {
        throw new Error(`LLM refused: ${message.refusal}`);
      }

      if (!message?.content) {
        throw new Error('Empty response from LLM');
      }

      content = message.content;
    }

    this.logger?.info(`[structured] API call completed (${content.length} chars)`);

    if (this.debugLogger?.shouldLog('structured')) {
      this.debugLogger.saveLog('structured_response.json', {
        choices: [{ message: { content } }],
        model: this.options.model,
      });
      this.debugLogger.markLogged('structured');
    }

    return this.parseStructuredResponse(content, schema);
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: All tests PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: support streaming for structured output calls"`

---

### Task 3: Add streaming edge case tests

**Goal:** Cover content_filter refusal, empty stream, and non-streaming still works when streaming=false.

**Step 1: Write the Tests**
- File: `src/services/llm/LLMApiClient.structured.test.ts`
- Code: Add three tests:
  ```typescript
  it('throws on content_filter finish_reason during streaming', async () => {
    const TestSchema = z.object({ value: z.string() });

    const chunks = [
      { choices: [{ delta: { content: '{"val' }, finish_reason: null }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] },
    ];

    const asyncIterable = {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () => i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true }
        };
      }
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger
    });

    await expect((client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    })).rejects.toThrow('Response refused by content filter');
  });

  it('throws on empty streaming response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const chunks = [
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];

    const asyncIterable = {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () => i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true }
        };
      }
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger
    });

    await expect((client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    })).rejects.toThrow('Empty response from LLM');
  });

  it('uses non-streaming when streaming option is false', async () => {
    const TestSchema = z.object({ value: z.string() });

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }]
    });

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: false,
      logger: mockLogger
    });

    const result = await (client as any).callStructured({
      prompt: { system: 'test', user: 'test' },
      schema: TestSchema,
      schemaName: 'TestSchema'
    });

    expect(result).toEqual({ value: 'ok' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: false }),
      expect.any(Object)
    );
  });
  ```

**Step 2: Run Tests (Red → Green)**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: All tests PASS (implementation from Task 2 already handles these cases)

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test: add streaming edge case tests for callStructured"`

---

### Task 4: Update CLAUDE.md documentation

**Goal:** Remove the "Non-Streaming: Structured outputs require `stream: false`" note and document the new streaming support.

**Step 1: Implementation**
- File: `CLAUDE.md`
- Action: Find the line that says structured outputs require `stream: false` and update it to reflect that streaming is now supported when enabled in stage config.

**Step 2: Verify**
- Command: `npx vitest run src/services/llm/LLMApiClient.structured.test.ts`
- Expect: All tests still PASS (docs-only change)

**Step 3: Git Commit**
- Command: `git add . && git commit -m "docs: update CLAUDE.md for streaming structured outputs"`
