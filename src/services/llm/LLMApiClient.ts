import OpenAI from 'openai';
import { defaultConfig } from '@/config';
import type { Logger } from '../Logger';
import { DebugLogger } from './DebugLogger';
import { zodToJsonSchema, type StructuredCallOptions } from './schemaUtils';
import { z } from 'zod';
import { RetriableError } from '@/errors';

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
    if (requestBody.response_format && (requestBody.response_format as any).type === 'json_schema') {
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
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      headers.set('Accept', 'application/json, text/event-stream');
      headers.set('Accept-Language', 'en-US,en;q=0.9');
      headers.set('Accept-Encoding', 'gzip, deflate, br');
      headers.set('Origin', origin);
      headers.set('Referer', origin + '/');
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
        headers.set('Referer', origin + '/');
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

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { success: false, error: 'Empty response from model' };
      }

      return { success: true, model: response.model };
    } catch (e: any) {
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
        const delta = chunk.choices[0]?.delta as any;
        content += delta?.content || delta?.reasoning || '';
      };

      if (!content) {
        return { success: false, error: 'Empty response from streaming endpoint' };
      }

      return { success: true, model };
    } catch (e: any) {
      return { success: false, error: this.formatApiError(e) };
    }
  }

  /**
   * Format API error for user display
   */
  private formatApiError(e: any): string {
    // OpenAI SDK error structure
    if (e?.error?.message) {
      return e.error.message;
    }
    // HTTP status errors
    if (e?.status) {
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
      return statusMap[e.status] || `HTTP ${e.status}: ${e.statusText || 'Error'}`;
    }
    // Network/fetch errors
    if (e?.cause?.code === 'ENOTFOUND' || e?.message?.includes('fetch')) {
      return 'Network Error - Check API URL and internet connection';
    }
    // Timeout
    if (e?.message?.includes('timeout') || e?.message?.includes('Timeout')) {
      return 'Request Timeout - Server took too long to respond';
    }
    // CORS
    if (e?.message?.includes('CORS') || e?.message?.includes('cors')) {
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
    // Strip markdown fences if model wraps JSON in ```json ... ```
    let jsonContent = content.trim();
    const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) jsonContent = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonContent);

    // Zod runtime validation - wrap errors as retriable since they may be transient LLM outputs
    try {
      return schema.parse(parsed);
    } catch (error) {
      // Convert Zod validation errors to RetriableError so they get retried
      throw new RetriableError(
        `Zod validation failed: ${(error as Error).message}`,
        error as Error
      );
    }
  }
}
