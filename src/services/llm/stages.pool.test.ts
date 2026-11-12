import { afterEach, describe, expect, it, vi } from 'vitest';

// The global setup mock flattens p-retry to a single attempt; these tests
// observe the retry ladder and park/eject routing, so they need the real one.
vi.unmock('p-retry');

import { RetriableError } from '@/errors';
import type { LLMCharacter, TextBlock } from '@/state/types';
import type { ILogger } from '../Logger';
import { DebugLogger } from './DebugLogger';
import type { PoolEntry } from './pool';
import { PoolExhaustedError } from './poolDraw';
import type { StructuredCallOptions } from './schemaUtils';
import { createLlmStages, type LLMClientConfig, type LlmStageDeps, type LlmStages } from './stages';

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const STAGE = {
  apiKey: 'stage-key',
  apiUrl: 'https://stage.example.com/v1',
  model: 'stage-model',
  temperature: 0.5,
  maxRetries: 2,
};

const poolEntry = (name: string, overrides: Partial<PoolEntry> = {}): PoolEntry => ({
  url: `https://${name}.example.com/v1`,
  key: `key-${name}`,
  name: `slot-${name}`,
  ...overrides,
});

const EXTRACT_OK = {
  reasoning: 'ok',
  characters: [
    { canonicalName: 'Undertaker', variations: ['Undertaker'], gender: 'male' as const },
  ],
};
const MERGE_OK = { reasoning: 'ok', merges: [[0, 1]] };
const characters: LLMCharacter[] = [
  { canonicalName: 'Undertaker', variations: ['Undertaker'], gender: 'male' },
  { canonicalName: 'Adele', variations: ['Adele'], gender: 'female' },
];

const block = (sentences: string[]): TextBlock[] => [
  { blockIndex: 0, sentenceStartIndex: 0, sentences },
];

type CallArg = StructuredCallOptions<unknown>;
type TransportCall = { config: LLMClientConfig; opts: CallArg };
type Transport = NonNullable<LlmStageDeps['transport']>;

function baseDeps(overrides: Partial<LlmStageDeps> = {}): LlmStageDeps {
  return {
    extract: { ...STAGE },
    assign: { ...STAGE },
    merge: { ...STAGE },
    narratorVoice: 'narrator',
    llmThreads: 1,
    useVoting: false,
    directoryHandle: null,
    logger: mockLogger,
    ...overrides,
  };
}

function captureTransport(route: (config: LLMClientConfig) => unknown): {
  transport: Transport;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: Transport = async (config, opts) => {
    calls.push({ config, opts });
    const result = route(config);
    if (result instanceof Error) throw result;
    return result as never;
  };
  return { transport, calls };
}

function serviceWithPool(
  entries: PoolEntry[],
  transport: Transport,
  overrides: Partial<LlmStageDeps> = {},
): LlmStages {
  return createLlmStages(baseDeps({ pool: entries, transport, ...overrides }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('LlmStages - Connection pool draw', () => {
  it('replaces the stage triple and carries entry tuning on every request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport, calls } = captureTransport(() => EXTRACT_OK);
    const service = serviceWithPool(
      [
        poolEntry('a', {
          model: 'pool-a-model',
          temperature: 0.25,
          max_output_tokens: 1234,
          chat_template_kwargs: { enable_thinking: false },
        }),
      ],
      transport,
    );

    await service.extract(block(['Line one.', 'Line two.']));

    expect(calls).toHaveLength(1);
    expect(calls[0].config).toMatchObject({
      apiUrl: 'https://a.example.com/v1',
      apiKey: 'key-a',
      model: 'pool-a-model',
      temperature: 0.25,
      maxTokens: 1234,
      thinking: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  it('draws slots round-robin from the frozen shuffled order', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport, calls } = captureTransport(() => EXTRACT_OK);
    const service = serviceWithPool([poolEntry('a'), poolEntry('b')], transport);

    await service.extract([
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['One.'] },
      { blockIndex: 1, sentenceStartIndex: 1, sentences: ['Two.'] },
      { blockIndex: 2, sentenceStartIndex: 2, sentences: ['Three.'] },
      { blockIndex: 3, sentenceStartIndex: 3, sentences: ['Four.'] },
    ]);

    expect(calls.map((call) => call.config.apiKey)).toEqual(['key-a', 'key-b', 'key-a', 'key-b']);
  });

  it('ejects an entry after an auth failure and retries the next slot', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    vi.useFakeTimers();
    const { transport, calls } = captureTransport((config) =>
      config.apiKey === 'key-a'
        ? new RetriableError('unauthorized', undefined, { errorClass: 'auth' })
        : EXTRACT_OK,
    );
    const service = serviceWithPool([poolEntry('a'), poolEntry('b')], transport);

    const pending = service.extract(block(['Undertaker met Undertaker, said Undertaker.']));
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toHaveLength(1);
    expect(calls.map((call) => call.config.apiKey)).toEqual(['key-a', 'key-b']);
  });

  it('parks only the rate-limited entry and serves the next call from a healthy slot', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport, calls } = captureTransport((config) =>
      config.apiKey === 'key-a'
        ? new RetriableError('rate limited', undefined, {
            kind: 'rate-limit',
            retryAfterMs: 60_000,
            errorClass: 'transport',
          })
        : EXTRACT_OK,
    );
    const service = serviceWithPool([poolEntry('a'), poolEntry('b')], transport, {
      extract: { ...STAGE, maxRetries: 0 },
    });

    const result = await service.extract([
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['Undertaker met Undertaker, said Undertaker.'],
      },
      {
        blockIndex: 1,
        sentenceStartIndex: 1,
        sentences: ['Undertaker left Undertaker, told Undertaker.'],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(calls.map((call) => call.config.apiKey)).toEqual(['key-a', 'key-b']);
  });

  it('fails the pass when every entry is ejected, with no stage-triple fallback', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    vi.useFakeTimers();
    const { transport, calls } = captureTransport(
      () => new RetriableError('forbidden', undefined, { errorClass: 'auth' }),
    );
    const service = serviceWithPool([poolEntry('a')], transport);

    const pending = service.extract(block(['Undertaker here.'])).catch((error) => error);
    await vi.runAllTimersAsync();

    expect(await pending).toBeInstanceOf(PoolExhaustedError);
    expect(calls.every((call) => call.config.apiKey === 'key-a')).toBe(true);
  });

  it('leaves the stage triple in place when the pool is empty', async () => {
    const { transport, calls } = captureTransport(() => EXTRACT_OK);
    const service = createLlmStages(baseDeps({ pool: [], transport }));

    await service.extract(block(['Line one.']));

    expect(calls[0].config).toMatchObject({
      apiUrl: STAGE.apiUrl,
      apiKey: STAGE.apiKey,
      model: STAGE.model,
    });
  });

  it('serves backup-split halves from pool slots, never the backup triple', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    let primary = true;
    const { transport, calls } = captureTransport(() => {
      if (primary) {
        primary = false;
        return new Error('primary failed');
      }
      return EXTRACT_OK;
    });
    const service = serviceWithPool([poolEntry('a'), poolEntry('b')], transport, {
      backup: {
        apiKey: 'backup-key',
        apiUrl: 'https://backup.example.com/v1',
        model: 'backup-model',
        maxRetries: 1,
      },
    });

    await service.extract(block(['First half line.', 'Second half line.']));

    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.config.model === 'backup-model')).toBe(false);
    expect(calls.every((call) => ['key-a', 'key-b'].includes(call.config.apiKey))).toBe(true);
  });

  it('overrides every merge vote temperature with the entry temperature', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport, calls } = captureTransport(() => MERGE_OK);
    const service = serviceWithPool(
      [poolEntry('a', { temperature: 0 }), poolEntry('b', { temperature: 0 })],
      transport,
    );

    await service.merge(characters);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.config.temperature).toBe(0);
      expect(['key-a', 'key-b']).toContain(call.config.apiKey);
    }
  });

  it('warns with the entry name when max_input_tokens is below the estimated prompt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport, calls } = captureTransport(() => EXTRACT_OK);
    const service = serviceWithPool([poolEntry('a', { max_input_tokens: 1 })], transport);

    await service.extract(block(['This sentence is much longer than one token.']));

    expect(calls).toHaveLength(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('slot-a'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('max_input_tokens'));
  });

  it('phase logs carry the pool name and slot but never key material', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { transport } = captureTransport(() => EXTRACT_OK);
    const savePhaseLog = vi
      .spyOn(DebugLogger.prototype, 'savePhaseLog')
      .mockResolvedValue(undefined);
    const service = serviceWithPool([poolEntry('a', { model: 'pool-a-model' })], transport);

    await service.extract(block(['Line one.']));

    const [phase, requestBody] = savePhaseLog.mock.calls[0];
    expect(phase).toBe('extract');
    expect(requestBody).toMatchObject({
      model: 'pool-a-model',
      pool: { name: 'slot-a', slot: 1 },
    });
    expect(JSON.stringify(requestBody)).not.toContain('key-a');
  });
});
