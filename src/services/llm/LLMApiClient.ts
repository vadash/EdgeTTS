import type OpenAIType from 'openai';
import OpenAI from 'openai';
import type { z } from 'zod';
import { RetriableError } from '@/errors';
import type { Logger } from '../Logger';
import type { DebugLogger } from './DebugLogger';
import { type StructuredCallOptions, zodToJsonSchema } from './schemaUtils';

type ChatCompletion = OpenAIType.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAIType.Chat.Completions.ChatCompletionChunk;

type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface LLMApiClientOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  debugLogger?: DebugLogger;
  logger?: Logger;
}

export type PassType = 'extract' | 'merge' | 'assign' | 'structured';

export interface LLMPrompt {
  system: string;
  user: string;
}

/**
 * Detect provider from API URL or model name
 */
function detectProvider(apiUrl: string, model: string): 'mistral' | 'openai' | 'unknown' {
  const lower = `${apiUrl} ${model}`.toLowerCase();
  if (lower.includes('mistral')) return 'mistral';
  if (lower.includes('openai')) return 'openai';
  return 'unknown';
}

/**
 * Apply provider-specific fixes to request body
 */
function applyProviderFixes(requestBody: Record<string, unknown>, provider: string): void {
  if (provider === 'mistral') {
    // Mistral requires top_p=1 when temperature=0 (greedy sampling)
    // Safest to just not send top_p at all
    delete requestBody.top_p;

    // Mistral doesn't support OpenAI's json_schema format.
    // Use json_object mode instead (instructs model to return valid JSON).
    const responseFormat = requestBody.response_format as ResponseFormat | undefined;
    if (responseFormat && responseFormat.type === 'json_schema') {
      requestBody.response_format = { type: 'json_object' };
    }
  }
}

/**
 * LLMApiClient - Handles LLM API communication with retry logic
 */
export class LLMApiClient {
  private options: LLMApiClientOptions;
  private logger?: Logger;
  private client: OpenAI;
  private debugLogger?: DebugLogger;
  private provider: string;

  constructor(options: LLMApiClientOptions) {
    this.options = options;
    this.logger = options.logger;
    this.debugLogger = options.debugLogger;
    this.provider = detectProvider(options.apiUrl, options.model);

    // Custom fetch that strips SDK headers (some proxies block them)
    // In test mode (Node.js), add browser-like headers to bypass CF
    const customFetch: typeof fetch = async (url, init) => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');

      // Copy Authorization from original headers
      if (init?.headers) {
        const h = new Headers(init.headers);
        const auth = h.get('Authorization');
        if (auth) headers.set('Authorization', auth);
      }

      // Detect test mode (Node.js environment)
      const isTestMode = typeof window === 'undefined' || typeof navigator === 'undefined';
      const origin = new URL(url.toString()).origin;

      // Full browser fingerprint
      headers.set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      headers.set('Accept', 'application/json, text/event-stream');
      headers.set('Accept-Language', 'en-US,en;q=0.9');
      headers.set('Accept-Encoding', 'gzip, deflate, br');
      headers.set('Origin', origin);
      headers.set('Referer', `${origin}/`);
      headers.set('Connection', 'keep-alive');
      headers.set('Sec-Fetch-Dest', 'empty');
      headers.set('Sec-Fetch-Mode', 'cors');
      headers.set('Sec-Fetch-Site', 'same-origin');
      headers.set('sec-ch-ua', '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
      headers.set('sec-ch-ua-mobile', '?0');
      headers.set('sec-ch-ua-platform', '"Windows"');

      if (!isTestMode) {
        // Browser mode - copy headers from current browser context
        headers.set('Accept', 'application/json, text/event-stream');
        // navigator.userAgent gives us the real browser UA
        if (navigator.userAgent) {
          headers.set('User-Agent', navigator.userAgent);
        }
        // navigator.language for Accept-Language
        if (navigator.language) {
          headers.set('Accept-Language', navigator.language);
        }
        // Set origin/referer to API endpoint (not our app origin)
        headers.set('Origin', origin);
        headers.set('Referer', `${origin}/`);
      }

      return fetch(url, { ...init, headers });
    };

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.apiUrl,
      dangerouslyAllowBrowser: true,
      maxRetries: 0, // We handle retries ourselves
      timeout: 180000, // 3 minute timeout
      fetch: customFetch,
    });
  }

  /**
   * Reset logging flags for new conversion
   */
  resetLogging(): void {
    this.debugLogger?.resetLogging();
  }

  /**
   * Test API connection with a real completion request (non-streaming)
   */
  async testConnection(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
        max_tokens: 10,
        stream: false,
      });

      const message = response.choices[0]?.message;
      const content = message?.content || (message as unknown as { reasoning?: string })?.reasoning;
      if (!content) {
        return { success: false, error: 'Empty response from model' };
      }

      return { success: true, model: response.model };
    } catch (e) {
      return { success: false, error: this.formatApiError(e) };
    }
  }

  /**
   * Test API connection with streaming (SSE) endpoint
   */
  async testConnectionStreaming(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
        max_tokens: 10,
        stream: true,
      });

      let content = '';
      let model = '';

      for await (const chunk of stream) {
        model = chunk.model || model;
        const delta = chunk.choices[0]?.delta;
        content += delta?.content || (delta as unknown as { reasoning?: string })?.reasoning || '';
      }

      if (!content) {
        return { success: false, error: 'Empty response from streaming endpoint' };
      }

      return { success: true, model };
    } catch (e) {
      return { success: false, error: this.formatApiError(e) };
    }
  }

  /**
   * Format API error for user display
   */
  private formatApiError(e: unknown): string {
    // OpenAI SDK error structure
    const apiError = e as {
      error?: { message?: string };
      status?: number;
      statusText?: string;
      cause?: { code?: string };
      message?: string;
    };
    if (apiError.error?.message) {
      return apiError.error.message;
    }
    // HTTP status errors
    if (typeof apiError.status === 'number') {
      const statusMap: Record<number, string> = {
        400: 'Bad Request - Check API URL format',
        401: 'Unauthorized - Invalid API key',
        403: 'Forbidden - API key lacks permissions',
        404: 'Not Found - Model or endpoint not found',
        429: 'Rate Limited - Too many requests',
        500: 'Server Error - API provider issue',
        502: 'Bad Gateway - API provider unreachable',
        503: 'Service Unavailable - API provider down',
      };
      return (
        statusMap[apiError.status] || `HTTP ${apiError.status}: ${apiError.statusText || 'Error'}`
      );
    }
    // Network/fetch errors
    if (apiError.cause?.code === 'ENOTFOUND' || apiError.message?.includes('fetch')) {
      return 'Network Error - Check API URL and internet connection';
    }
    // Timeout
    if (apiError.message?.includes('timeout') || apiError.message?.includes('Timeout')) {
      return 'Request Timeout - Server took too long to respond';
    }
    // CORS
    if (apiError.message?.includes('CORS') || apiError.message?.includes('cors')) {
      return 'CORS Error - API does not allow browser requests';
    }
    // Generic Error object
    if (e instanceof Error) {
      return e.message;
    }
    // String error
    if (typeof e === 'string') {
      return e;
    }
    return 'Unknown error';
  }

  /**
   * Call LLM with structured output enforcement.
   * Returns validated, typed result directly.
   *
   * @param options - Structured call options including prompt, schema, schema name
   * @returns Parsed and validated result matching the schema
   * @throws Error if LLM refuses or returns empty response
   */
  async callStructured<T>({ prompt, schema, schemaName }: StructuredCallOptions<T>): Promise<T> {
    const useStreaming = this.options.streaming ?? false;

    const requestBody: Record<string, unknown> = {
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
      try {
        const streamResult = await this.client.chat.completions.create({
          ...requestBody,
          stream: true,
        } as any);

        const stream = streamResult as unknown as AsyncIterable<ChatCompletionChunk>;

        let accumulated = '';
        let finishReason: string | null = null;

        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              accumulated += delta.content;
            }
            if (chunk.choices[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
          }
        } catch (error) {
          throw new RetriableError(`Streaming failed: ${(error as Error).message}`, error as Error);
        }

        if (finishReason === 'content_filter') {
          throw new RetriableError('Response refused by content filter');
        }

        if (!accumulated) {
          throw new RetriableError('Empty response from LLM');
        }

        content = accumulated;
      } catch (error) {
        throw new RetriableError(
          `LLM API call failed: ${(error as Error).message}`,
          error as Error,
        );
      }
    } else {
      // Non-streaming path
      let response: ChatCompletion;
      try {
        response = await this.client.chat.completions.create({
          ...requestBody,
          stream: false,
        } as any);
        response = response as ChatCompletion;
      } catch (error) {
        throw new RetriableError(
          `LLM API call failed: ${(error as Error).message}`,
          error as Error,
        );
      }

      const message = response.choices[0]?.message;

      if (message?.refusal) {
        throw new RetriableError(`LLM refused: ${message.refusal}`);
      }

      if (!message?.content) {
        throw new RetriableError('Empty response from LLM');
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

  /**
   * Parse JSON content and validate with Zod schema.
   * Shared by both streaming and non-streaming paths.
   */
  private parseStructuredResponse<T>(content: string, schema: z.ZodType<T>): T {
    let jsonContent = content.trim();
    const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) jsonContent = fenceMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (error) {
      throw new RetriableError(`JSON parse failed: ${(error as Error).message}`, error as Error);
    }

    try {
      return schema.parse(parsed);
    } catch (error) {
      throw new RetriableError(
        `Zod validation failed: ${(error as Error).message}`,
        error as Error,
      );
    }
  }
}
