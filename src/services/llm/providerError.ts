import type { RetriableKind } from '@/errors';

/** Transport-level failure wording: outage, DNS, refused/blocked connection, gateway down. */
const NETWORK_DOWN =
  /\b50[234]\b|failed to execute http request|failed to fetch|fetch failed|networkerror|network error|load failed|internet disconnected/i;

/**
 * Classify one caught provider error for the rate-limit gate. Inspects only
 * the error itself — never its `cause` chain — because `LLMApiClient` calls
 * this at each transport catch site, where the raw SDK error (status +
 * headers) is in hand. Order of trust: HTTP status, retry-after headers,
 * then provider prose as a last resort (which keeps the sidecar's
 * `retry-after-ms` deadline alive).
 */
export function classifyProviderError(error: unknown): {
  kind?: RetriableKind;
  retryAfterMs?: number;
} {
  const candidate = error as {
    status?: unknown;
    headers?: Headers | Record<string, string>;
    message?: string;
  };

  if (candidate?.status === 429) return { kind: 'rate-limit' };

  if (candidate?.status === 502 || candidate?.status === 503 || candidate?.status === 504) {
    return { kind: 'network-down' };
  }

  const readHeader = (name: string): string | null => {
    const headers = candidate?.headers;
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string>;
    return record[name] ?? record[name.toLowerCase()] ?? null;
  };

  const headerMs = Number(readHeader('retry-after-ms'));
  if (Number.isFinite(headerMs) && headerMs > 0) {
    return { kind: 'rate-limit', retryAfterMs: headerMs };
  }

  const headerSeconds = Number(readHeader('retry-after'));
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return { kind: 'rate-limit', retryAfterMs: headerSeconds * 1000 };
  }

  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (!message) return {};

  if (NETWORK_DOWN.test(message)) return { kind: 'network-down' };

  if (/\b429\b|rate[-_ ]?limit/i.test(message)) {
    const ms = /retry[-_ ]?after[-_ ]?ms["'\s]*[=:]\s*["']?(\d+)/i.exec(message);
    return { kind: 'rate-limit', retryAfterMs: ms ? Number(ms[1]) : undefined };
  }

  return {};
}
