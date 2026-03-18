import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LLMApiClient } from './LLMApiClient';

// Mock OpenAI client factory
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
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
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
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
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
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
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'fenced' });
  });

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
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'streamed' });

    // Verify stream: true was passed
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Empty response from LLM');
  });

  it('uses non-streaming when streaming option is false', async () => {
    const TestSchema = z.object({ value: z.string() });

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
    });

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      streaming: false,
      logger: mockLogger,
    });

    const result = await (client as any).callStructured({
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'ok' });
    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).toMatchObject({ stream: false });
  });

  it('saves debug logs on Zod validation error', async () => {
    const TestSchema = z.object({
      requiredField: z.string(),
    });

    const mockResponse = {
      choices: [
        {
          message: {
            content: '{"missing": "field"}', // Missing requiredField
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow();

    // Should have saved error logs
    expect(mockSaveErrorLog).toHaveBeenCalledTimes(1);
    const [requestBody, responseContent] = mockSaveErrorLog.mock.calls[0];
    expect(requestBody).toHaveProperty('model', 'gpt-4o-mini');
    expect(responseContent).toBe('{"missing": "field"}');
  });

  it('does NOT save debug logs on infrastructure errors', async () => {
    const TestSchema = z.object({ value: z.string() });

    // Simulate network error
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
        messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
        schema: TestSchema,
        schemaName: 'TestSchema',
      }),
    ).rejects.toThrow('Network Error');

    // Should NOT have saved error logs for infrastructure errors
    expect(mockSaveErrorLog).not.toHaveBeenCalled();
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
      messages: [{ role: 'system' as const, content: 'test' }, { role: 'user' as const, content: 'test' }],
      schema: TestSchema,
      schemaName: 'TestSchema',
    });

    expect(result).toEqual({ value: 'success' });
    // Should NOT have saved error logs on success
    expect(mockSaveErrorLog).not.toHaveBeenCalled();
  });
});
