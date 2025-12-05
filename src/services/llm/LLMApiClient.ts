import type { LLMValidationResult } from '@/state/types';
import { getRetryDelay } from '@/config';
import type { ILogger } from '../interfaces';

export interface LLMApiClientOptions {
  apiKey: string;
  apiUrl: string;
  model: string;
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
  private extractLogged = false;
  private mergeLogged = false;
  private assignLogged = false;

  constructor(options: LLMApiClientOptions) {
    this.options = options;
    this.logger = options.logger;
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

        // Validation failed - retry with errors in prompt
        previousErrors = validation.errors;
        const delay = getRetryDelay(attempt);
        attempt++;

        this.logger?.info(`[${pass}] Validation failed, retry ${attempt}, waiting ${delay / 1000}s...`, { errors: validation.errors });
        onRetry?.(attempt, delay, validation.errors);
        await this.sleep(delay);
      } catch (error) {
        if (signal?.aborted) {
          throw new Error('Operation cancelled');
        }

        const delay = getRetryDelay(attempt);
        attempt++;
        this.logger?.info(`[${pass}] API error, retry ${attempt}, waiting ${delay / 1000}s...`, { error: String(error) });
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
    const messages: Array<{ role: string; content: string }> = [
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

    const requestBody = {
      model: this.options.model,
      messages,
      max_tokens: 4000,
      temperature: 0.0,
      top_p: 0.95,
    };

    // Save request log (first call only per pass type)
    if (pass === 'extract' && !this.extractLogged) {
      this.saveLog('extract_request.json', requestBody);
    } else if (pass === 'merge' && !this.mergeLogged) {
      this.saveLog('merge_request.json', requestBody);
    } else if (pass === 'assign' && !this.assignLogged) {
      this.saveLog('assign_request.json', requestBody);
    }

    const response = await fetch(`${this.options.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

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

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Extract JSON from response (handle markdown code blocks)
    return this.extractJSON(content);
  }

  /**
   * Extract JSON from response (handles markdown code blocks and thinking tags)
   */
  private extractJSON(content: string): string {
    // Remove thinking tags (used by some LLMs like DeepSeek)
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // Try to extract from markdown code block
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    // Try to find raw JSON object
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return cleaned.trim();
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
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.options.apiUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      });

      if (response.ok) {
        return { success: true };
      }

      const error = await response.text();
      return { success: false, error: `API error ${response.status}: ${error}` };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
