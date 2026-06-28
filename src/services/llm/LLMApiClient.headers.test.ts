import { describe, expect, it, vi } from 'vitest';
import { LLMApiClient } from './LLMApiClient';

// We test customFetch by mocking the underlying global.fetch.
// The OpenAI SDK passes our customFetch to its internal HTTP layer,
// which eventually calls the real fetch (our mock).
describe('LLMApiClient header handling', () => {
  function mockFetchAndCreateClient(opts?: { apiUrl?: string }) {
    const originalFetch = globalThis.fetch;
    const mockFn = vi.fn(async (_url: any, _init: any) => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = mockFn as any;

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: opts?.apiUrl ?? 'https://api.test.com/v1',
      model: 'test-model',
    });

    return {
      client,
      mockFn,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  async function triggerRequest(client: LLMApiClient) {
    try {
      await client.testConnection();
    } catch {
      /* ignore */
    }
  }

  function getCallHeaders(mockFn: any): Headers {
    const call = mockFn.mock.calls[0];
    return call[1]?.headers as Headers;
  }

  it('should preserve Authorization and Content-Type headers', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const headers = getCallHeaders(mockFn);
      expect(headers).toBeInstanceOf(Headers);
      expect(headers.get('Authorization')).toContain('test-key');
      expect(headers.get('Content-Type')).toBe('application/json');
    } finally {
      restore();
    }
  });

  it('should strip Referer and Origin headers', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const headers = getCallHeaders(mockFn);
      expect(headers.get('Referer')).toBeNull();
      expect(headers.get('Origin')).toBeNull();
    } finally {
      restore();
    }
  });

  it('should strip X-Stainless-* telemetry headers', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const headers = getCallHeaders(mockFn);
      const stainlessHeaders: string[] = [];
      headers.forEach((_v, k) => {
        if (k.toLowerCase().startsWith('x-stainless-')) stainlessHeaders.push(k);
      });
      expect(stainlessHeaders).toEqual([]);
    } finally {
      restore();
    }
  });

  it('should strip OpenAI-Organization and OpenAI-Project headers', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const headers = getCallHeaders(mockFn);
      expect(headers.get('OpenAI-Organization')).toBeNull();
      expect(headers.get('OpenAI-Project')).toBeNull();
    } finally {
      restore();
    }
  });

  it('should strip User-Agent header', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const headers = getCallHeaders(mockFn);
      expect(headers.get('User-Agent')).toBeNull();
    } finally {
      restore();
    }
  });

  it('should not send credentials: include', async () => {
    const { client, mockFn, restore } = mockFetchAndCreateClient();
    try {
      await triggerRequest(client);
      const call = mockFn.mock.calls[0];
      const init = call[1] as RequestInit;
      expect(init.credentials).not.toBe('include');
    } finally {
      restore();
    }
  });

  it('should handle headers passed as plain object', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, _init) => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    try {
      const client = new LLMApiClient({
        apiKey: 'test-key',
        apiUrl: 'https://api.test.com/v1',
        model: 'test-model',
      });

      await triggerRequest(client);

      // At minimum, nothing should crash with any header format
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
