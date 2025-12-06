import { describe, it, expect } from 'vitest';
import { testConfig } from '../../test.config.local';

/**
 * Parse SSE stream (same logic as LLMApiClient)
 */
async function parseSSEStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let content = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  return content;
}

describe('LLM Streaming Debug', () => {
  const { apiKey, apiUrl, model } = testConfig;

  it('should parse SSE stream correctly', async () => {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say exactly: "Hello, world!"' }],
        max_tokens: 50,
        stream: true,
      }),
    });

    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));

    expect(response.ok).toBe(true);

    const content = await parseSSEStream(response);
    console.log('Parsed content:', content);

    expect(content).toBeTruthy();
    expect(content.toLowerCase()).toContain('hello');
  });

  it('should show raw SSE chunks for debugging', async () => {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "hi"' }],
        max_tokens: 10,
        stream: true,
      }),
    });

    console.log('Streaming Status:', response.status);
    console.log('Streaming Content-Type:', response.headers.get('content-type'));

    const text = await response.text();
    console.log('Raw SSE:', text.substring(0, 2000));
  });
});
