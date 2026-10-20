import { describe, expect } from 'vitest';

import { classifyProviderError } from './providerError';

describe('classifyProviderError', (t) => {
  t('classifies a 429 status as rate-limit', () => {
    expect(classifyProviderError({ status: 429, message: 'Too many requests' })).toEqual({
      kind: 'rate-limit',
      errorClass: 'transport',
    });
  });

  t('classifies a gateway 503 status as network-down', () => {
    expect(classifyProviderError({ status: 503, message: 'Service Unavailable' })).toEqual({
      kind: 'network-down',
      errorClass: 'transport',
    });
  });

  t('classifies 401 and 403 statuses as auth', () => {
    expect(classifyProviderError({ status: 401, message: 'Unauthorized' })).toEqual({
      errorClass: 'auth',
    });
    expect(classifyProviderError({ status: 403, message: 'Forbidden' })).toEqual({
      errorClass: 'auth',
    });
  });

  t('reads a retry-after-ms header', () => {
    expect(classifyProviderError({ headers: new Headers({ 'retry-after-ms': '119000' }) })).toEqual(
      { kind: 'rate-limit', retryAfterMs: 119_000, errorClass: 'transport' },
    );
  });

  t('reads a retry-after header (seconds)', () => {
    expect(classifyProviderError({ headers: new Headers({ 'retry-after': '120' }) })).toEqual({
      kind: 'rate-limit',
      retryAfterMs: 120_000,
      errorClass: 'transport',
    });
  });

  t('reads a retry-after-ms header from a plain record', () => {
    expect(classifyProviderError({ headers: { 'retry-after-ms': '5000' } })).toEqual({
      kind: 'rate-limit',
      retryAfterMs: 5_000,
      errorClass: 'transport',
    });
  });

  t('parses the sidecar prose deadline', () => {
    expect(
      classifyProviderError({
        message: '429 sidecar: pool z-ai/glm-5.2 rate-limited, circuit open retry-after-ms=119000',
      }),
    ).toEqual({ kind: 'rate-limit', retryAfterMs: 119_000, errorClass: 'transport' });
  });

  t('never walks the cause chain', () => {
    expect(
      classifyProviderError({
        message: 'LLM API call failed: something broke',
        cause: { message: 'sidecar: circuit open retry-after-ms=60000' },
      }),
    ).toEqual({});
  });

  t('classifies transport failure wording as network-down', () => {
    expect(classifyProviderError({ message: 'Failed to fetch' })).toEqual({
      kind: 'network-down',
      errorClass: 'transport',
    });
  });

  t('returns nothing for unrelated errors', () => {
    expect(classifyProviderError(new Error('Request timed out.'))).toEqual({});
    expect(classifyProviderError(undefined)).toEqual({});
  });
});
