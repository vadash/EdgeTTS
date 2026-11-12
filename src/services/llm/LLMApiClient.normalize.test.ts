import { describe, expect, it, vi } from 'vitest';
import { LLMApiClient, normalizeApiUrl } from './LLMApiClient';

describe('normalizeApiUrl', () => {
  it('passes a plain base through', () => {
    expect(normalizeApiUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('strips one trailing /chat/completions so the SDK does not double it', () => {
    expect(normalizeApiUrl('https://router.example/abc/v1/chat/completions')).toBe(
      'https://router.example/abc/v1',
    );
  });

  it('strips trailing slashes before matching', () => {
    expect(normalizeApiUrl('https://router.example/abc/v1/chat/completions///')).toBe(
      'https://router.example/abc/v1',
    );
  });
});

describe('LLMApiClient full-endpoint baseURL', () => {
  it('requests .../v1/chat/completions once when apiUrl is the full endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const mockFn = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = mockFn;

    try {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://router.example/abc/v1/chat/completions',
        model: 'test-model',
      });
      await client.testConnection();
      const firstCall = mockFn.mock.calls[0] as unknown[] | undefined;
      expect(firstCall).toBeDefined();
      const requested = String(firstCall?.[0]);
      expect(requested).toBe('https://router.example/abc/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
