import { describe, expect, it, vi } from 'vitest';
import { LLMApiClient } from './LLMApiClient';

// We test customFetch by mocking the underlying global.fetch.
// The OpenAI SDK passes our customFetch to its internal HTTP layer,
// which eventually calls the real fetch (our mock).
describe('LLMApiClient header handling', () => {
  it('should copy all init headers (including Authorization) via new Headers(init?.headers)', async () => {
    // Capture the fetch call made by our customFetch
    const originalFetch = globalThis.fetch;
    const capturedCalls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];

    // Mock global.fetch at the lowest level — customFetch calls this
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedCalls.push({ url: url as string, init });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.test.com/v1',
        model: 'test-model',
      });

      // Trigger a request through testConnection which calls the OpenAI SDK
      try {
        await client.testConnection();
      } catch {
        // Ignore — we only care about the fetch call, not the response shape
      }

      // Our customFetch should have been called, forwarding to global.fetch
      expect(globalThis.fetch).toHaveBeenCalled();
      const call = (globalThis.fetch as any).mock.calls[0];
      const headers = call[1]?.headers;

      // Should be a Headers instance
      expect(headers).toBeInstanceOf(Headers);

      // Should have Authorization copied from init.headers (OpenAI SDK sets this)
      expect(headers.get('Authorization')).toContain('test-key');

      // Should have Content-Type set
      expect(headers.get('Content-Type')).toBe('application/json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should not hardcode User-Agent in test mode', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.test.com/v1',
        model: 'test-model',
      });

      try {
        await client.testConnection();
      } catch {
        // Ignore
      }

      const call = (globalThis.fetch as any).mock.calls[0];
      const headers = call[1]?.headers as Headers;

      // In test mode (jsdom), User-Agent should NOT be the hardcoded Chrome string
      const ua = headers.get('User-Agent');
      expect(ua).not.toContain('Chrome/120.0.0.0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
