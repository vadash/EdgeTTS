import type OpenAIType from 'openai';
import OpenAI from 'openai';
import { ZodError } from 'zod';
import { RetriableError } from '@/errors';
import { safeParseJSON } from '@/utils/text';
import type { ILogger } from '../Logger';
import type { DebugLogger } from './DebugLogger';
import { classifyProviderError } from './providerError';
import { noteError, noteSuccess, waitTurn } from './rateLimitGate';
import { type StructuredCallOptions, zodToJsonSchema } from './schemaUtils';

type ChatCompletion = OpenAIType.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAIType.Chat.Completions.ChatCompletionChunk;
type ChatCompletionCreateParamsNonStreaming =
  OpenAIType.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatCompletionCreateParamsStreaming =
  OpenAIType.Chat.Completions.ChatCompletionCreateParamsStreaming;

/** Request body: OpenAI params plus OpenAI-compatible vendor extensions (thinking/reasoning). */
type StructuredRequestBody = Omit<ChatCompletionCreateParamsNonStreaming, 'stream'> & {
  enable_thinking?: boolean;
  reasoning_effort?: 'high' | 'medium' | 'low';
  chat_template_kwargs?: { enable_thinking: boolean };
};

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
  reasoning?: 'auto' | 'high' | 'medium' | 'low' | null;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  corsMiddleware?: string;
  debugLogger?: DebugLogger;
  logger?: ILogger;
}

function detectProvider(apiUrl: string, model: string): 'mistral' | 'openai' | 'unknown' {
  const lower = `${apiUrl} ${model}`.toLowerCase();
  if (lower.includes('mistral')) return 'mistral';
  if (lower.includes('openai')) return 'openai';
  return 'unknown';
}

function applyProviderFixes(requestBody: StructuredRequestBody, provider: string): void {
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
 * Reasoning kill switch for thinking-by-default models (Nemotron, Qwen3).
 * The template kwarg alone is not honoured by every proxy, so the inline
 * marker is appended to system and user turns as a fallback.
 */
function disableThinking(requestBody: StructuredRequestBody): void {
  requestBody.chat_template_kwargs = { enable_thinking: false };
  requestBody.messages = requestBody.messages.map((message) => {
    if (
      (message.role === 'system' || message.role === 'user') &&
      typeof message.content === 'string'
    ) {
      return { ...message, content: `${message.content}\n\n/no_think` };
    }
    return message;
  });
}

export class LLMApiClient {
  private options: LLMApiClientOptions;
  private logger?: ILogger;
  private client: OpenAI;
  public debugLogger?: DebugLogger;
  private provider: string;

  constructor(options: LLMApiClientOptions) {
    this.options = options;
    this.logger = options.logger;
    this.debugLogger = options.debugLogger;
    this.provider = detectProvider(options.apiUrl, options.model);

    // new Headers(init?.headers) copies ALL existing headers (including Authorization
    // set by the OpenAI SDK), so no manual per-header copy is needed.
    const corsMiddleware = options.corsMiddleware?.trim() || '';
    const apiBase = options.apiUrl.replace(/\/+$/, '');

    const customFetch: typeof fetch = async (url, init) => {
      let fetchUrl = url as string | URL;

      if (corsMiddleware) {
        const middlewareBase = corsMiddleware.replace(/\/+$/, '');
        const urlStr = typeof fetchUrl === 'string' ? fetchUrl : fetchUrl.toString();
        const afterBase = urlStr.replace(apiBase, '');
        fetchUrl = middlewareBase + afterBase;
      }

      const headers = new Headers(init?.headers);

      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const isTestMode = typeof window === 'undefined' || typeof navigator === 'undefined';

      if (!isTestMode) {
        // Browser mode: add headers that strict CORS servers accept.
        headers.set('Accept', 'application/json, text/event-stream');
        if (navigator.language) {
          headers.set('Accept-Language', `${navigator.language},en;q=0.9`);
        }
      }

      // Strip headers that cause CORS preflight failures on strict servers
      // (e.g. Gemini returns 403 if any unauthorized header appears in the
      // preflight's Access-Control-Request-Headers). The Headers API is
      // case-insensitive, so delete() works regardless of casing.
      const stripped = [
        'referer', // when explicitly set, it becomes an author request header in the preflight
        'origin', // forbidden header; browser sends its own, this set() is a no-op
        'user-agent', // forbidden header; OpenAI SDK sets it but browser ignores
        'openai-organization',
        'openai-project',
      ];
      for (const name of stripped) {
        headers.delete(name);
      }
      // Strip all X-Stainless-* telemetry headers injected by the OpenAI SDK.
      // These are not in any provider's CORS allowlist and cause preflight 403s.
      const keysToDelete: string[] = [];
      headers.forEach((_value, key) => {
        if (key.toLowerCase().startsWith('x-stainless-')) {
          keysToDelete.push(key);
        }
      });
      for (const key of keysToDelete) {
        headers.delete(key);
      }

      return fetch(fetchUrl, {
        ...init,
        headers,
        // No credentials: 'include' because no LLM API returns
        // Access-Control-Allow-Credentials: true, so including credentials
        // would cause the browser to reject the response even if the preflight passes.
      });
    };

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.apiUrl,
      dangerouslyAllowBrowser: true,
      maxRetries: 0, // We handle retries ourselves
      timeout: 240000, // 4 minutes: large prompts on slow local models exceed 3 minutes
      fetch: customFetch,
    });
  }

  resetLogging(): void {
    this.debugLogger?.resetLogging();
  }

  async testConnection(
    streaming = false,
  ): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      if (!streaming) {
        const response = await this.client.chat.completions.create({
          model: this.options.model,
          messages: [{ role: 'user', content: 'Reply with: ok' }],
          max_tokens: 10,
          stream: false,
        });

        const message = response.choices[0]?.message;
        // Reasoning-first models expose text on a sibling field the SDK types don't declare
        const ext = message as unknown as { reasoning?: string };
        const content = message?.content || ext?.reasoning;
        if (!content) {
          return { success: false, error: 'Empty response from model' };
        }

        return { success: true, model: response.model };
      }

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
        // Streaming variant of the same vendor reasoning extension
        const deltaExt = delta as unknown as { reasoning?: string };
        content += delta?.content || deltaExt?.reasoning || '';
      }

      if (!content) {
        return { success: false, error: 'Empty response from streaming endpoint' };
      }

      return { success: true, model };
    } catch (e) {
      return { success: false, error: this.formatApiError(e) };
    }
  }

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
    if (apiError.cause?.code === 'ENOTFOUND' || apiError.message?.includes('fetch')) {
      return 'Network Error - Check API URL and internet connection';
    }
    if (apiError.message?.includes('timeout') || apiError.message?.includes('Timeout')) {
      return 'Request Timeout - Server took too long to respond';
    }
    // CORS: check the message directly, then walk the cause chain.
    // When the browser blocks a CORS preflight, fetch() throws a TypeError.
    // The OpenAI SDK wraps it as APIConnectionError with the generic message
    // "Connection error.", so we inspect the cause chain for CORS indicators.
    const corsErrorMessage =
      'CORS Error - API does not allow browser requests. Start a local CORS proxy and set the proxy URL in Advanced Settings.';
    if (apiError.message?.includes('CORS') || apiError.message?.includes('cors')) {
      return corsErrorMessage;
    }
    let cause: unknown = (apiError as { cause?: unknown }).cause;
    while (cause) {
      const c = cause as { message?: string; code?: string; cause?: unknown };
      const msg = c.message?.toLowerCase() || '';
      if (
        msg.includes('cors') ||
        msg.includes('blocked') ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror')
      ) {
        return corsErrorMessage;
      }
      cause = c.cause;
    }
    // SDK's generic "Connection error." with a TypeError cause = CORS failure in browser
    if (
      apiError.message === 'Connection error.' &&
      (apiError as { cause?: unknown }).cause instanceof TypeError
    ) {
      return corsErrorMessage;
    }
    if (e instanceof Error) {
      return e.message;
    }
    if (typeof e === 'string') {
      return e;
    }
    return 'Unknown error';
  }

  /**
   * @throws Error if the LLM refuses or returns an empty response
   */
  async callStructured<T>({
    messages,
    schema,
    schemaName,
    signal,
  }: StructuredCallOptions<T>): Promise<T> {
    const useStreaming = this.options.streaming ?? false;

    const requestBody: StructuredRequestBody = {
      model: this.options.model,
      messages,
      response_format: zodToJsonSchema(schema, schemaName),
    };

    if (this.options.maxTokens) {
      requestBody.max_tokens = this.options.maxTokens;
    }
    if (this.options.temperature !== undefined) {
      requestBody.temperature = this.options.temperature;
    }
    if (this.options.topP !== undefined) {
      requestBody.top_p = this.options.topP;
    }
    // Only add thinking/reasoning parameters when explicitly enabled.
    // When reasoning is null or undefined (OFF), actively suppress thinking:
    // models that reason by default otherwise burn the whole token budget on
    // prose and never emit the JSON payload.
    if (this.options.reasoning != null) {
      requestBody.enable_thinking = true;
      // OpenAI-compatible APIs use reasoning_effort for level specification
      if (this.options.reasoning !== 'auto') {
        requestBody.reasoning_effort = this.options.reasoning;
      }
    } else {
      disableThinking(requestBody);
    }
    applyProviderFixes(requestBody, this.provider);

    this.logger?.info(`[structured] API call starting (streaming: ${useStreaming})...`);

    // Park while the rate-limit governor holds; checked per attempt since this
    // method is the retry body invoked by withRetry. signal is forwarded so a
    // user-driven cancel isn't blocked for minutes behind a cooldown.
    await waitTurn(signal);

    let content: string;

    try {
      if (useStreaming) {
        try {
          const streamResult = await this.client.chat.completions.create({
            ...requestBody,
            stream: true,
          } as unknown as ChatCompletionCreateParamsStreaming);

          const stream = streamResult as unknown as AsyncIterable<ChatCompletionChunk>;

          let accumulated = '';
          let reasoningAccumulated = '';
          let finishReason: string | null = null;

          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta as
                | { content?: string | null; reasoning?: string; reasoning_content?: string }
                | undefined;
              if (delta?.content) {
                accumulated += delta.content;
              }
              // Reasoning never joins the payload buffer: mixing chain-of-thought
              // into content is what makes schema parsing fail downstream.
              if (delta?.reasoning) {
                reasoningAccumulated += delta.reasoning;
              }
              if (delta?.reasoning_content) {
                reasoningAccumulated += delta.reasoning_content;
              }
              if (chunk.choices[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }
            }
          } catch (error) {
            throw new RetriableError(
              `Streaming failed: ${(error as Error).message}`,
              error as Error,
              classifyProviderError(error),
            );
          }

          if (finishReason === 'content_filter') {
            throw new RetriableError('Response refused by content filter', undefined, {
              kind: 'data',
            });
          }

          // Some OpenAI-compatible proxies emit the whole payload on the
          // reasoning channel and leave content empty. Prefer content, but fall
          // back rather than discarding a response that may still hold the JSON.
          if (!accumulated.trim() && reasoningAccumulated.trim()) {
            accumulated = reasoningAccumulated;
          }

          if (!accumulated) {
            throw new RetriableError('Empty response from LLM', undefined, { kind: 'data' });
          }

          content = accumulated;
        } catch (error) {
          throw new RetriableError(
            `LLM API call failed: ${(error as Error).message}`,
            error as Error,
            classifyProviderError(error),
          );
        }
      } else {
        let response: ChatCompletion;
        try {
          response = await this.client.chat.completions.create({
            ...requestBody,
            stream: false,
          } as unknown as ChatCompletionCreateParamsNonStreaming);
        } catch (error) {
          throw new RetriableError(
            `LLM API call failed: ${(error as Error).message}`,
            error as Error,
            classifyProviderError(error),
          );
        }

        const message = response.choices[0]?.message as
          | {
              content?: string | null;
              reasoning?: string;
              reasoning_content?: string;
              refusal?: string;
            }
          | undefined;

        if (message?.refusal) {
          throw new RetriableError(`LLM refused: ${message.refusal}`, undefined, {
            kind: 'data',
          });
        }

        // Mirror the streaming fallback: some proxies emit the payload on the
        // reasoning channel and leave content empty.
        const reasoningContent = message?.reasoning || message?.reasoning_content || '';
        if (!message?.content && reasoningContent.trim()) {
          content = reasoningContent;
        } else if (message?.content) {
          content = message.content;
        } else {
          throw new RetriableError('Empty response from LLM', undefined, { kind: 'data' });
        }
      }
    } catch (error) {
      // A 429 or network outage trips the gate so parallel workers stop
      // hammering the dead circuit; other errors keep their existing behavior.
      noteError(error, this.logger);
      throw error;
    }

    noteSuccess(this.logger);

    this.logger?.info(`[structured] API call completed (${content.length} chars)`);

    try {
      const result = safeParseJSON(content, { schema });
      if (!result.success) {
        throw new RetriableError(`JSON parse failed: ${result.error!.message}`, undefined, {
          kind: 'data',
        });
      }
      return result.data!;
    } catch (error) {
      if (this.isDataQualityError(error)) {
        await this.debugLogger?.saveErrorLog(requestBody, content);
      }
      throw error;
    }
  }

  private isDataQualityError(error: unknown): boolean {
    if (error instanceof ZodError) {
      return true;
    }
    // RetriableError carries a data-quality tag when thrown from a payload path
    if (error instanceof RetriableError) {
      return error.kind === 'data';
    }
    return false;
  }
}
