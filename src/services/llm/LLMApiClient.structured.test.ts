import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMApiClient } from './LLMApiClient';
import { z } from 'zod';

// Mock OpenAI client factory
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }))
}));

describe('LLMApiClient.callStructured', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockClear();
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

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger
    });

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

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger
    });

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

    mockCreate.mockResolvedValue(mockResponse);

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      logger: mockLogger
    });

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
});
