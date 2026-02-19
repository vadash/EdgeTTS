import OpenAI from 'openai';
import pRetry, { AbortError } from 'p-retry';
import type { LLMValidationResult } from '@/state/types';
import { getRetryDelay, defaultConfig } from '@/config';
import type { ILogger } from '../interfaces';
import { stripThinkingTags, extractJSON } from '@/utils/llmUtils';
import { DebugLogger } from './DebugLogger';

export interface LLMApiClientOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  debugLogger?: DebugLogger;
  logger?: ILogger;
}

export type PassType = 'extract' | 'merge' | 'assign';

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
  }
}

/**
 * LLMApiClient - Handles LLM API communication with retry logic
 */
export class LLMApiClient {
  private options: LLMApiClientOptions;
  private logger?: ILogger;
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
   * Call LLM API with retry and exponential backoff using p-retry
   * @param maxRetries - Maximum retries before giving up. Undefined = infinite retries.
   * @returns Response string, or null if maxRetries exceeded
   */
  async callWithRetry(
    prompt: LLMPrompt,
    validate: (response: string) => LLMValidationResult,
    signal?: AbortSignal,
    initialErrors: string[] = [],
    pass: PassType = 'extract',
    onRetry?: (attempt: number, delay: number, errors?: string[]) => void,
    maxRetries?: number
  ): Promise<string | null> {
    // Track errors across retries (outside p-retry to accumulate)
    let previousErrors = [...initialErrors];

    // p-retry doesn't support Infinity, use MAX_SAFE_INTEGER instead
    const retries = maxRetries === undefined ? Number.MAX_SAFE_INTEGER : maxRetries;

    try {
      return await pRetry(
        async (attemptNumber) => {
          // Check for cancellation
          if (signal?.aborted) {
            throw new AbortError('Operation cancelled');
          }

          const response = await this.call(prompt, signal, previousErrors, pass);
          const validation = validate(response);

          if (validation.valid) {
            return response;
          }

          // Validation failed - accumulate errors so LLM doesn't repeat mistakes
          const newErrors = validation.errors.filter(e => !previousErrors.includes(e));
          previousErrors = [...previousErrors, ...newErrors];

          // Throw to trigger retry
          const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
          (error as any).validationErrors = previousErrors;
          (error as any).responsePreview = response.substring(0, 300);
          throw error;
        },
        {
          retries,
          signal,
          onFailedAttempt: (error) => {
            const delay = getRetryDelay(error.attemptNumber - 1);

            // Check if this was a validation error or API error
            // p-retry passes context object with {error, attemptNumber, ...}
            const originalError = (error as any).error || error;
            const isValidationError = 'validationErrors' in originalError;

            if (isValidationError) {
              this.logger?.warn(
                `[${pass}] Validation failed, retry ${error.attemptNumber}, waiting ${delay / 1000}s...`,
                { errors: originalError.validationErrors, response: originalError.responsePreview }
              );
            } else {
              this.logger?.error(
                `[${pass}] API error, retry ${error.attemptNumber}, waiting ${delay / 1000}s...`,
                originalError instanceof Error ? originalError : new Error(String(originalError))
              );
            }

            onRetry?.(error.attemptNumber, delay, previousErrors);
          },
          // Custom retry delay using existing getRetryDelay function
          // p-retry passes attemptNumber (1-based), getRetryDelay expects 0-based index
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          minTimeout: defaultConfig.retry.delays[0],
          maxTimeout: defaultConfig.retry.delays[defaultConfig.retry.delays.length - 1],
          // Override factor to use our custom delays via minTimeout/maxTimeout bounds
          factor: 1.5,
        }
      );
    } catch (error) {
      // AbortError means cancelled - rethrow
      if (error instanceof AbortError) {
        throw new Error('Operation cancelled');
      }

      // Max retries exceeded
      this.logger?.warn(`[${pass}] Max retries exceeded, giving up`, { errors: previousErrors });
      return null;
    }
  }

  /**
   * Make a single LLM API call
   */
  private async call(
    prompt: LLMPrompt,
    signal?: AbortSignal,
    previousErrors: string[] = [],
    pass: PassType = 'extract'
  ): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];

    // Add error context if retrying
    if (previousErrors.length > 0) {
      messages.push({
        role: 'user',
        content: `Your previous response had these errors:\n${previousErrors.join('\n')}\n\nPlease fix and try again.`,
      });
    }

    // Build request body - use 'any' to allow dynamic parameters
    // that the strict OpenAI SDK types might not fully support (like reasoning_effort)
    const requestBody: any = {
      model: this.options.model,
      messages,
      stream: this.options.streaming !== false,
      max_tokens: defaultConfig.llm.maxTokens,
    };

    // Handle Reasoning vs Standard models
    if (this.options.reasoning) {
      requestBody.reasoning_effort = this.options.reasoning;
      // Reasoning models crash if you send temperature or top_p - don't add them
    } else {
      requestBody.temperature = this.options.temperature ?? 0.0;
      requestBody.top_p = this.options.topP ?? 0.95;
    }

    // Apply provider-specific fixes (e.g., Mistral doesn't allow top_p with temperature=0)
    applyProviderFixes(requestBody, this.provider);

    // Save request log (first call only per pass type)
    if (this.debugLogger?.shouldLog(pass)) {
      this.debugLogger.saveLog(`${pass}_request.json`, requestBody);
    }

    // Make API call
    let content = '';
    this.logger?.info(`[${pass}] API call starting... temp=${requestBody.temperature ?? '-'} top_p=${requestBody.top_p ?? '-'} reasoning=${requestBody.reasoning_effort ?? '-'}`);

    if (requestBody.stream) {
      const stream = await this.client.chat.completions.create(requestBody as OpenAI.ChatCompletionCreateParamsStreaming, { signal });
      for await (const chunk of stream) {
        content += chunk.choices[0]?.delta?.content || '';
      }
    } else {
      const response = await this.client.chat.completions.create(requestBody as OpenAI.ChatCompletionCreateParamsNonStreaming, { signal });
      content = response.choices[0]?.message?.content || '';
    }

    this.logger?.info(`[${pass}] API call completed (${content.length} chars)`);

    // Build response object for logging
    const data = {
      choices: [{ message: { content } }],
      model: this.options.model,
    };

    // Save response log (first call only per pass type)
    if (this.debugLogger?.shouldLog(pass)) {
      this.debugLogger.saveLog(`${pass}_response.json`, data);
      this.debugLogger.markLogged(pass);
    }

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Assign pass uses line-based format (index:CODE), not JSON
    if (pass === 'assign') {
      return stripThinkingTags(content).trim();
    }

    // Extract JSON from response (handle markdown code blocks)
    return extractJSON(content);
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
        content += chunk.choices[0]?.delta?.content || '';
      }

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
}
