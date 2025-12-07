import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { jsonrepair } from 'jsonrepair';
import type { LLMValidationResult } from '@/state/types';
import { getRetryDelay } from '@/config';
import type { ILogger } from '../interfaces';

export interface LLMApiClientOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
  streaming?: boolean;
  reasoning?: 'auto' | 'high' | 'medium' | 'low';
  temperature?: number;
  topP?: number;
  directoryHandle?: FileSystemDirectoryHandle | null;
  logger?: ILogger;
}

export type PassType = 'extract' | 'merge' | 'assign';

export interface LLMPrompt {
  system: string;
  user: string;
}

/**
 * LLMApiClient - Handles LLM API communication with retry logic
 */
export class LLMApiClient {
  private options: LLMApiClientOptions;
  private logger?: ILogger;
  private client: OpenAI;
  private extractLogged = false;
  private mergeLogged = false;
  private assignLogged = false;

  constructor(options: LLMApiClientOptions) {
    this.options = options;
    this.logger = options.logger;

    // Custom fetch that strips SDK headers (some proxies block them)
    const customFetch: typeof fetch = async (url, init) => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      if (init?.headers) {
        const h = new Headers(init.headers);
        const auth = h.get('Authorization');
        if (auth) headers.set('Authorization', auth);
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
    this.extractLogged = false;
    this.mergeLogged = false;
    this.assignLogged = false;
  }

  /**
   * Call LLM API with infinite retry and exponential backoff
   */
  async callWithRetry(
    prompt: LLMPrompt,
    validate: (response: string) => LLMValidationResult,
    signal?: AbortSignal,
    previousErrors: string[] = [],
    pass: PassType = 'extract',
    onRetry?: (attempt: number, delay: number, errors?: string[]) => void
  ): Promise<string> {
    let attempt = 0;

    while (true) {
      try {
        const response = await this.call(prompt, signal, previousErrors, pass);
        const validation = validate(response);

        if (validation.valid) {
          return response;
        }

        // Validation failed - accumulate errors so LLM doesn't repeat mistakes
        const newErrors = validation.errors.filter(e => !previousErrors.includes(e));
        previousErrors = [...previousErrors, ...newErrors];
        const delay = getRetryDelay(attempt);
        attempt++;

        this.logger?.warn(`[${pass}] Validation failed, retry ${attempt}, waiting ${delay / 1000}s...`, { errors: previousErrors, response: response.substring(0, 300) });
        onRetry?.(attempt, delay, previousErrors);
        await this.sleep(delay);
      } catch (error) {
        if (signal?.aborted) {
          throw new Error('Operation cancelled');
        }

        const delay = getRetryDelay(attempt);
        attempt++;
        this.logger?.error(`[${pass}] API error, retry ${attempt}, waiting ${delay / 1000}s...`, error instanceof Error ? error : new Error(String(error)));
        onRetry?.(attempt, delay);
        await this.sleep(delay);
      }
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
    };

    // Handle Reasoning vs Standard models
    if (this.options.reasoning) {
      // REASONING MODE (e.g., o1, o3-mini)
      // Map 'auto' to 'medium' for standard OpenAI, pass as-is for proxies that support it
      requestBody.reasoning_effort = this.options.reasoning === 'auto' ? 'medium' : this.options.reasoning;
      requestBody.max_completion_tokens = 4000;
      // Reasoning models crash if you send temperature or top_p - don't add them
    } else {
      // STANDARD MODE (e.g., gpt-4o, claude-3.5)
      requestBody.max_tokens = 4000;
      requestBody.temperature = this.options.temperature ?? 0.0;
      requestBody.top_p = this.options.topP ?? 0.95;
    }

    // Save request log (first call only per pass type)
    if (pass === 'extract' && !this.extractLogged) {
      this.saveLog('extract_request.json', requestBody);
    } else if (pass === 'merge' && !this.mergeLogged) {
      this.saveLog('merge_request.json', requestBody);
    } else if (pass === 'assign' && !this.assignLogged) {
      this.saveLog('assign_request.json', requestBody);
    }

    // Make API call - handle both streaming and non-streaming modes
    let content = '';
    this.logger?.info(`[${pass}] API call starting...`);
    const isStreaming = this.options.streaming !== false;

    if (isStreaming) {
      // Streaming mode - use explicit type to help TypeScript
      const streamParams: ChatCompletionCreateParamsStreaming = {
        model: requestBody.model,
        messages: requestBody.messages,
        stream: true,
      };
      // Add optional parameters
      if (requestBody.reasoning_effort) (streamParams as any).reasoning_effort = requestBody.reasoning_effort;
      if (requestBody.max_completion_tokens) streamParams.max_completion_tokens = requestBody.max_completion_tokens;
      if (requestBody.max_tokens) streamParams.max_tokens = requestBody.max_tokens;
      if (requestBody.temperature !== undefined) streamParams.temperature = requestBody.temperature;
      if (requestBody.top_p !== undefined) streamParams.top_p = requestBody.top_p;

      const stream = await this.client.chat.completions.create(streamParams, { signal });
      for await (const chunk of stream) {
        content += chunk.choices[0]?.delta?.content || '';
      }
    } else {
      // Non-streaming mode - use explicit type to help TypeScript
      const nonStreamParams: ChatCompletionCreateParamsNonStreaming = {
        model: requestBody.model,
        messages: requestBody.messages,
        stream: false,
      };
      // Add optional parameters
      if (requestBody.reasoning_effort) (nonStreamParams as any).reasoning_effort = requestBody.reasoning_effort;
      if (requestBody.max_completion_tokens) nonStreamParams.max_completion_tokens = requestBody.max_completion_tokens;
      if (requestBody.max_tokens) nonStreamParams.max_tokens = requestBody.max_tokens;
      if (requestBody.temperature !== undefined) nonStreamParams.temperature = requestBody.temperature;
      if (requestBody.top_p !== undefined) nonStreamParams.top_p = requestBody.top_p;

      const response = await this.client.chat.completions.create(nonStreamParams, { signal });
      content = response.choices[0]?.message?.content || '';
    }

    this.logger?.info(`[${pass}] API call completed (${content.length} chars)`);

    // Build response object for logging
    const data = {
      choices: [{ message: { content } }],
      model: this.options.model,
    };

    // Save response log (first call only per pass type)
    if (pass === 'extract' && !this.extractLogged) {
      this.saveLog('extract_response.json', data);
      this.extractLogged = true;
    } else if (pass === 'merge' && !this.mergeLogged) {
      this.saveLog('merge_response.json', data);
      this.mergeLogged = true;
    } else if (pass === 'assign' && !this.assignLogged) {
      this.saveLog('assign_response.json', data);
      this.assignLogged = true;
    }

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Assign pass uses line-based format (index:CODE), not JSON
    if (pass === 'assign') {
      return content.trim();
    }

    // Extract JSON from response (handle markdown code blocks)
    return this.extractJSON(content);
  }

  /**
   * Extract JSON from response (handles markdown code blocks and thinking tags)
   * Uses jsonrepair to fix common LLM JSON issues (trailing commas, missing quotes, etc.)
   */
  private extractJSON(content: string): string {
    // Remove thinking tags (used by some LLMs like DeepSeek)
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    let jsonCandidate: string;

    // Try to extract from markdown code block
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonCandidate = jsonMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const objectMatch = cleaned.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonCandidate = objectMatch[0];
      } else {
        jsonCandidate = cleaned.trim();
      }
    }

    // Repair common JSON issues (trailing commas, missing quotes, unclosed brackets)
    return jsonrepair(jsonCandidate);
  }

  /**
   * Save log file to logs folder
   */
  private async saveLog(filename: string, content: object): Promise<void> {
    if (!this.options.directoryHandle) return;
    try {
      const logsFolder = await this.options.directoryHandle.getDirectoryHandle('logs', { create: true });
      const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(content, null, 2));
      await writable.close();
    } catch (e) {
      this.logger?.warn('Failed to save log', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Test API connection with a real completion request
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
      let error = 'Unknown error';

      // OpenAI SDK error structure
      if (e?.error?.message) {
        error = e.error.message;
      }
      // HTTP status errors
      else if (e?.status) {
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
        error = statusMap[e.status] || `HTTP ${e.status}: ${e.statusText || 'Error'}`;
      }
      // Network/fetch errors
      else if (e?.cause?.code === 'ENOTFOUND' || e?.message?.includes('fetch')) {
        error = 'Network Error - Check API URL and internet connection';
      }
      // Timeout
      else if (e?.message?.includes('timeout') || e?.message?.includes('Timeout')) {
        error = 'Request Timeout - Server took too long to respond';
      }
      // CORS
      else if (e?.message?.includes('CORS') || e?.message?.includes('cors')) {
        error = 'CORS Error - API does not allow browser requests';
      }
      // Generic Error object
      else if (e instanceof Error) {
        error = e.message;
      }
      // String error
      else if (typeof e === 'string') {
        error = e;
      }

      return { success: false, error };
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
