import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RetriableError } from '@/errors';
import { LLMApiClient, type LLMApiClientOptions } from './LLMApiClient';
import { getLimit, resetRateLimitGate } from './rateLimitGate';
import { AssignSchema } from './schemas';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  }),
}));

describe('LLMApiClient.callStructured', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockClear();
    // The gate is process-global: a mocked network failure parks every later
    // test in waitTurn for the cooldown unless it is reset here.
    resetRateLimitGate();
  });

  it('parses valid structured response', async () => {
    const TestSchema = z.object({
      message: z.string(),
      count: z.number().int(),
    });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"message":"hello","count":42}',
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    const result = await (client as any).callStructured({
      messages: [
        { role: 'system' as const, content: 'test' },
        { role: 'user' as const, content: 'test' },
      ],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ message: 'hello', count: 42 });
  });

  it('throws on refusal response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: {
            content: null,
            refusal: 'Content policy violation',
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('LLM refused: Content policy violation');
  });

  it('throws on empty response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: {
            content: null,
            refusal: null,
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Empty response from LLM');
  });

  it('uses non-streaming mode for structured outputs', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: { content: '{"value":"test"}', refusal: null },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    await (client as any).callStructured({
      messages: [
        { role: 'system' as const, content: 'test' },
        { role: 'user' as const, content: 'test' },
      ],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
        },
      },
    });
  });

  it('strips markdown fences from response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: { content: '```json\n{"value":"fenced"}\n```', refusal: null },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    const result = await (client as any).callStructured({
      messages: [
        { role: 'system' as const, content: 'test' },
        { role: 'user' as const, content: 'test' },
      ],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'fenced' });
  });

  it('streams structured response when streaming enabled', async () => {
    const TestSchema = z.object({ value: z.string() });

    const chunks = [
      { choices: [{ delta: { content: '{"val' }, finish_reason: null }], model: 'gpt-4o-mini' },
      { choices: [{ delta: { content: 'ue":"str' }, finish_reason: null }], model: 'gpt-4o-mini' },
      { choices: [{ delta: { content: 'eamed"}' }, finish_reason: 'stop' }], model: 'gpt-4o-mini' },
    ];

    const asyncIterable = {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () =>
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
        };
      },
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger,
    });

    const result = await (client as any).callStructured({
      messages: [
        { role: 'system' as const, content: 'test' },
        { role: 'user' as const, content: 'test' },
      ],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'streamed' });

    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toMatchObject({ stream: true });
  });

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
          next: async () =>
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
        };
      },
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Response refused by content filter');
  });

  it('throws on empty streaming response', async () => {
    const TestSchema = z.object({ value: z.string() });

    const chunks = [{ choices: [{ delta: {}, finish_reason: 'stop' }] }];

    const asyncIterable = {
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return {
          next: async () =>
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
        };
      },
    };

    mockCreate.mockResolvedValue(asyncIterable);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: true,
      logger: mockLogger,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Empty response from LLM');
  });

  it('saves debug logs on Zod validation error', async () => {
    const TestSchema = z.object({
      requiredField: z.string(),
    });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"missing": "field"}',
            refusal: null,
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow();

    expect(mockSaveErrorLog).toHaveBeenCalledTimes(1);
    const [requestBody, responseContent] = mockSaveErrorLog.mock.calls[0];
    expect(requestBody).toHaveProperty('model', 'gpt-4o-mini');
    expect(responseContent).toBe('{"missing": "field"}');
  });

  it('does NOT save debug logs on infrastructure errors', async () => {
    const TestSchema = z.object({ value: z.string() });

    mockCreate.mockRejectedValue(new Error('Network Error'));

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Network Error');

    expect(mockSaveErrorLog).not.toHaveBeenCalled();
  });

  it('trips the rate-limit gate on a 429-shaped provider rejection', async () => {
    const TestSchema = z.object({ value: z.string() });

    // SDK-shaped error: the classifier trusts error.status first and reads the
    // message only as a fallback.
    mockCreate.mockRejectedValue(
      Object.assign(new Error('429 Too Many Requests'), { status: 429 }),
    );

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
    });

    await expect(
      (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('LLM API call failed: 429 Too Many Requests');

    expect(getLimit()).toBe(1);
  });

  it('does NOT save debug logs on successful parse', async () => {
    const TestSchema = z.object({ value: z.string() });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"value": "success"}',
            refusal: null,
          },
        },
      ],
    };

    mockCreate.mockResolvedValue(mockResponse);

    const mockSaveErrorLog = vi.fn();
    const mockDebugLogger = {
      saveErrorLog: mockSaveErrorLog,
      resetLogging: vi.fn(),
    };

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger,
      debugLogger: mockDebugLogger as any,
    });

    const result = await (client as any).callStructured({
      messages: [
        { role: 'system' as const, content: 'test' },
        { role: 'user' as const, content: 'test' },
      ],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'success' });
    expect(mockSaveErrorLog).not.toHaveBeenCalled();
  });

  describe('reasoning mode', () => {
    const TestSchema = z.object({ value: z.string() });
    const mockResponse = {
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
    };

    beforeEach(() => {
      mockCreate.mockResolvedValue(mockResponse);
    });

    it('omits thinking parameters when reasoning is undefined', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        reasoning: undefined,
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('enable_thinking');
      expect(callArgs).not.toHaveProperty('reasoning_effort');
    });

    it('sends enable_thinking=true and reasoning_effort=low', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        reasoning: 'low',
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.enable_thinking).toBe(true);
      expect(callArgs.reasoning_effort).toBe('low');
    });

    it('sends enable_thinking=true and reasoning_effort=medium', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        reasoning: 'medium',
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'test' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.enable_thinking).toBe(true);
      expect(callArgs.reasoning_effort).toBe('medium');
    });
  });

  describe('reasoning-off suppression', () => {
    const TestSchema = z.object({ value: z.string() });
    const mockResponse = {
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
    };

    beforeEach(() => {
      mockCreate.mockResolvedValue(mockResponse);
    });

    it('sends chat_template_kwargs and /no_think when reasoning is null', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'http://100.68.220.59:8088/v1',
        model: 'nvidia/nemotron-3-super-120b-a12b',
        reasoning: null,
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'Extract speakers.' },
          { role: 'user' as const, content: 'John said hi.' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(callArgs.enable_thinking).toBeUndefined();
      expect(callArgs.reasoning_effort).toBeUndefined();
      expect(callArgs.messages[0].content).toMatch(/\/no_think$/);
      expect(callArgs.messages[1].content).toMatch(/\/no_think$/);
    });

    it('does NOT suppress thinking when reasoning is on', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'http://100.68.220.59:8088/v1',
        model: 'nvidia/nemotron-3-super-120b-a12b',
        reasoning: 'low',
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [
          { role: 'system' as const, content: 'Extract.' },
          { role: 'user' as const, content: 'test' },
        ],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.chat_template_kwargs).toBeUndefined();
      expect(callArgs.enable_thinking).toBe(true);
      expect(callArgs.messages[0].content).not.toMatch(/\/no_think/);
    });

    it('suppresses thinking when reasoning is undefined (default off)', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'http://example.com/v1',
        model: 'qwen3',
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(callArgs.messages[0].content).toMatch(/\/no_think$/);
    });
  });

  describe('sampling parameters', () => {
    const TestSchema = z.object({ value: z.string() });
    const mockResponse = {
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
    };

    beforeEach(() => {
      mockCreate.mockResolvedValue(mockResponse);
    });

    it('wires temperature and top_p into request body', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        temperature: 0.3,
        topP: 0.9,
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.3);
      expect(callArgs.top_p).toBe(0.9);
    });

    it('omits temperature and top_p when not set', async () => {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        logger: mockLogger,
      });

      await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('temperature');
      expect(callArgs).not.toHaveProperty('top_p');
    });
  });

  describe('reasoning-channel fallback', () => {
    const TestSchema = z.object({ value: z.string() });

    it('falls back to reasoning when content is empty (streaming)', async () => {
      const chunks = [
        { choices: [{ delta: { reasoning: '{"val' }, finish_reason: null }] },
        { choices: [{ delta: { reasoning: 'ue":"fallback"}' }, finish_reason: 'stop' }] },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: async () =>
              i < chunks.length
                ? { value: chunks[i++], done: false }
                : { value: undefined, done: true },
          };
        },
      };

      mockCreate.mockResolvedValue(asyncIterable);

      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'nemotron',
        streaming: true,
        logger: mockLogger,
      });

      const result = await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      expect(result).toEqual({ value: 'fallback' });
    });

    it('does not mix reasoning into content when content is present (streaming)', async () => {
      const chunks = [
        {
          choices: [
            { delta: { reasoning: 'chain of thought', content: '{"val' }, finish_reason: null },
          ],
        },
        { choices: [{ delta: { content: 'ue":"ok"}' }, finish_reason: 'stop' }] },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: async () =>
              i < chunks.length
                ? { value: chunks[i++], done: false }
                : { value: undefined, done: true },
          };
        },
      };

      mockCreate.mockResolvedValue(asyncIterable);

      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'nemotron',
        streaming: true,
        logger: mockLogger,
      });

      const result = await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      expect(result).toEqual({ value: 'ok' });
    });

    it('falls back to reasoning_content when content is empty (non-streaming)', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: null, reasoning_content: '{"value":"ns"}', refusal: null } },
        ],
      });

      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'nemotron',
        logger: mockLogger,
      });

      const result = await (client as any).callStructured({
        messages: [{ role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      expect(result).toEqual({ value: 'ns' });
    });

    it('throws empty response when neither content nor reasoning present (non-streaming)', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null, refusal: null } }],
      });

      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'nemotron',
        logger: mockLogger,
      });

      await expect(
        (client as any).callStructured({
          messages: [{ role: 'user' as const, content: 'test' }],
          schema: TestSchema,
          schemaName: 'TestSchema',
        }),
      ).rejects.toThrow('Empty response from LLM');
    });
  });

  describe('error classes and degenerate output', () => {
    const TestSchema = z.object({ value: z.string() });
    const messages = [{ role: 'user' as const, content: 'test' }];

    function buildClient(overrides: Partial<LLMApiClientOptions> = {}) {
      return new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        logger: mockLogger,
        ...overrides,
      });
    }

    function chunkStream(chunks: unknown[]) {
      return {
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: async () =>
              i < chunks.length
                ? { value: chunks[i++], done: false }
                : { value: undefined, done: true },
          };
        },
      };
    }

    async function rejectionOf(promise: Promise<unknown>): Promise<RetriableError> {
      return (await promise.then(
        () => null,
        (error) => error,
      )) as RetriableError;
    }

    it('aborts a degenerate stream once content crosses maxTokens×6 chars', async () => {
      let delivered = 0;
      const stream = {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            delivered += 1;
            return {
              value: {
                choices: [{ delta: { content: 'x'.repeat(20) }, finish_reason: null }],
              },
              done: false,
            };
          },
        }),
      };
      // Six chunks would total 120 chars; the bound (10 × 6 = 60) must abort
      // the attempt at chunk 4, without consuming the tail of the stream.
      mockCreate.mockResolvedValue(stream);

      const client = buildClient({ streaming: true, maxTokens: 10 });
      const error = await rejectionOf(
        client.callStructured({ messages, schema: TestSchema, schemaName: 'TestSchema' }),
      );

      expect(error).toBeInstanceOf(RetriableError);
      expect(error.errorClass).toBe('transport');
      expect(error.message).toContain('Degenerate output');
      expect(delivered).toBe(4);
      // The abort is not a rate-limit or outage: the gate stays pristine.
      expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    });

    it('throws the same transport-class failure for an oversized non-streaming response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'y'.repeat(100), refusal: null } }],
      });

      const client = buildClient({ maxTokens: 10 });
      const error = await rejectionOf(
        client.callStructured({ messages, schema: TestSchema, schemaName: 'TestSchema' }),
      );

      expect(error).toBeInstanceOf(RetriableError);
      expect(error.errorClass).toBe('transport');
      expect(error.message).toContain('Degenerate output');
      expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    });

    it('surfaces 401 and 403 as auth-class failures', async () => {
      for (const status of [401, 403]) {
        mockCreate.mockRejectedValueOnce({ status, message: `HTTP ${status}` });

        const client = buildClient();
        const error = await rejectionOf(
          client.callStructured({
            messages,
            schema: TestSchema,
            schemaName: 'TestSchema',
          }),
        );

        expect(error).toBeInstanceOf(RetriableError);
        expect(error.errorClass).toBe('auth');
        // Auth failures never park the gate.
        expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
      }
    });

    it('surfaces a JSON parse failure as parse-class at the propagating boundary', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json at all', refusal: null } }],
      });

      const client = buildClient();
      const error = await rejectionOf(
        client.callStructured({ messages, schema: TestSchema, schemaName: 'TestSchema' }),
      );

      expect(error).toBeInstanceOf(RetriableError);
      expect(error.message).toContain('JSON parse failed');
      expect(error.errorClass).toBe('parse');
    });

    it('leaves a normal-size stream and the rate-limit gate untouched', async () => {
      const chunks = [
        { choices: [{ delta: { content: '{"val' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'ue":"fine"}' }, finish_reason: 'stop' }] },
      ];
      mockCreate.mockResolvedValue(chunkStream(chunks));

      const client = buildClient({ streaming: true, maxTokens: 10 });
      const result = await client.callStructured({
        messages,
        schema: TestSchema,
        schemaName: 'TestSchema',
      });

      expect(result).toEqual({ value: 'fine' });
      expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('wire-schema sanitization', () => {
    const messages = [{ role: 'user' as const, content: 'test' }];

    function buildClient(overrides: Partial<LLMApiClientOptions> = {}) {
      return new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        logger: mockLogger,
        ...overrides,
      });
    }

    function sentSchema(callIndex: number): Record<string, unknown> {
      const body = mockCreate.mock.calls[callIndex][0] as {
        response_format: { json_schema: { schema: Record<string, unknown> } };
      };
      return body.response_format.json_schema.schema;
    }

    it('sends a sanitized wire copy for an openai-family route', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: '{"reasoning":null,"assignments":{"0":"A"}}', refusal: null } },
        ],
      });

      const client = buildClient();
      await client.callStructured({
        messages,
        schema: AssignSchema,
        schemaName: 'AssignSchema',
      });

      const schema = sentSchema(0);
      const assignments = schema.properties as Record<string, Record<string, unknown>>;
      expect(assignments.assignments.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    });

    it('sanitizes unknown-family routes too (free aggregators)', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
      });

      const client = buildClient({ apiUrl: 'https://router.example.com/v1' });
      await client.callStructured({
        messages,
        schema: z.object({ value: z.string() }),
        schemaName: 'TestSchema',
      });

      const schema = sentSchema(0);
      expect(schema.required).toEqual(['value']);
    });

    it('surfaces a schema-rejecting 400 as a deterministic failure', async () => {
      mockCreate.mockRejectedValueOnce({
        status: 400,
        message:
          "400 Invalid schema for response_format 'AssignSchema': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Extra required key 'assignments' supplied.",
      });

      const client = buildClient();
      const error = await client
        .callStructured({
          messages,
          schema: AssignSchema,
          schemaName: 'AssignSchema',
        })
        .then(
          () => null,
          (e) => e,
        );

      expect(error).toBeInstanceOf(RetriableError);
      expect(error.errorClass).toBe('deterministic');
      expect(getLimit()).toBe(Number.POSITIVE_INFINITY);
    });

    it('keeps other 400s transport-class', async () => {
      mockCreate.mockRejectedValueOnce({ status: 400, message: '400 Bad Request' });

      const client = buildClient();
      const error = await client
        .callStructured({
          messages,
          schema: z.object({ value: z.string() }),
          schemaName: 'TestSchema',
        })
        .then(
          () => null,
          (e) => e,
        );

      expect(error).toBeInstanceOf(RetriableError);
      expect(error.errorClass).toBe('transport');
    });
  });
});
