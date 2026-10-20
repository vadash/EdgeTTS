import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The global setup mock flattens p-retry to a single attempt; these tests
// observe retry-ladder behavior, so they need the real scheduler.
vi.unmock('p-retry');

import { defaultConfig } from '@/config';
import { RetriableError } from '@/errors';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { DebugLogger } from '../llm/DebugLogger';
import { createLlmStages } from '../llm/stages';
import type { LLMClientConfig, LlmStageDeps } from '../llm/stages';
import type { StructuredCallOptions } from '../llm/schemaUtils';

const warn = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn,
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as ILogger;

const PRIMARY = {
  apiKey: 'primary-key',
  apiUrl: 'https://api.openai.com/v1',
  model: 'primary-model',
};
const BACKUP = {
  apiKey: 'backup-key',
  apiUrl: 'https://backup.api.com/v1',
  model: 'backup-model',
  maxRetries: 0,
};

type FailureClass = NonNullable<RetriableError['errorClass']>;
type TransportCall = { config: LLMClientConfig; opts: StructuredCallOptions<unknown> };

const classError = (errorClass: FailureClass) =>
  new RetriableError(`${errorClass} failure`, undefined, { errorClass });

function capture(route: (config: LLMClientConfig) => unknown): {
  transport: NonNullable<LlmStageDeps['transport']>;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: NonNullable<LlmStageDeps['transport']> = async (config, opts) => {
    calls.push({ config, opts });
    const result = route(config);
    if (result instanceof Error) throw result;
    return result as never;
  };
  return { transport, calls };
}

const count = (calls: TransportCall[], model: string) =>
  calls.filter((c) => c.config.model === model).length;

function baseDeps(overrides: Partial<LlmStageDeps> = {}): LlmStageDeps {
  return {
    extract: { ...PRIMARY },
    assign: { ...PRIMARY },
    merge: { ...PRIMARY },
    narratorVoice: 'narrator-voice',
    llmThreads: 2,
    useVoting: false,
    directoryHandle: null,
    logger: mockLogger,
    ...overrides,
  };
}

const ALICE: LLMCharacter = { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' };
const ALICIA: LLMCharacter = { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' };
const BOB: LLMCharacter = { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' };

const block = (sentences: string[]): TextBlock[] => [
  { blockIndex: 0, sentenceStartIndex: 0, sentences },
];

describe('LlmStages - error-class routing (ADR 0020)', () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('routes an assign parse failure straight to the backup split without exhausting primary retries', async () => {
    let half = 0;
    const { transport, calls } = capture((config) => {
      if (config.model === BACKUP.model) {
        half++;
        return { assignments: { '0': half === 1 ? 'A' : 'B' }, reasoning: null };
      }
      return classError('parse');
    });
    let nextCode = 0;
    const service = createLlmStages(
      baseDeps({
        transport,
        backup: { ...BACKUP },
        speakerCodeFactory: () => ['A', 'B', 'C', 'D', 'E'][nextCode++] ?? 'X9',
      }),
    );

    const result = await service.assign(
      block(['"Hi," said Alice.', 'Alice waved.', '"Hey," said Bob.', 'Bob left.']),
      new Map(),
      [ALICE, BOB],
    );

    // One primary attempt: parse skips the remaining retries (default budget 3).
    expect(count(calls, PRIMARY.model)).toBe(1);
    // The existing halves machinery took over.
    expect(count(calls, BACKUP.model)).toBe(2);
    // First-half key untouched; second-half key shifted by the first-half length.
    expect(result[0].speaker).toBe('Alice');
    expect(result[2].speaker).toBe('Bob');
  });

  it('routes an extract parse failure to the backup split and concatenates the halves', async () => {
    let half = 0;
    const { transport, calls } = capture((config) => {
      if (config.model === BACKUP.model) {
        half++;
        const name = half === 1 ? 'Alice' : 'Bob';
        return {
          characters: [
            { canonicalName: name, variations: [name], gender: half === 1 ? 'female' : 'male' },
          ],
        };
      }
      return classError('parse');
    });
    const service = createLlmStages(baseDeps({ transport, backup: { ...BACKUP } }));

    const result = await service.extract(
      block([
        'Alice said hi.',
        'Alice waved.',
        'Alice left.',
        'Bob came.',
        'Bob spoke.',
        'Bob stayed.',
      ]),
    );

    expect(count(calls, PRIMARY.model)).toBe(1);
    expect(count(calls, BACKUP.model)).toBe(2);
    expect(result.map((c) => c.canonicalName)).toEqual(['Alice', 'Bob']);
  });

  it('keeps the full primary retry ladder on transport-class failures', async () => {
    vi.useFakeTimers();
    const { transport, calls } = capture((config) =>
      config.model === BACKUP.model ? { characters: [ALICE] } : classError('transport'),
    );
    const service = createLlmStages(
      baseDeps({
        transport,
        backup: { ...BACKUP },
        extract: { ...PRIMARY, maxRetries: 2 },
        assign: { ...PRIMARY, maxRetries: 2 },
        merge: { ...PRIMARY, maxRetries: 2 },
      }),
    );

    const pending = service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(count(calls, PRIMARY.model)).toBe(3); // 1 + maxRetries, unchanged
    expect(count(calls, BACKUP.model)).toBe(2);
    expect(result.map((c) => c.canonicalName)).toEqual(['Alice']);
  });

  it('keeps the full primary ladder on parse failures when no Backup model is configured', async () => {
    vi.useFakeTimers();
    const { transport, calls } = capture(() => classError('parse'));
    const service = createLlmStages(baseDeps({ transport }));

    const pending = service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));
    await vi.runAllTimersAsync();
    const result = await pending;

    // Degrade (skip the block), but without a split path the parse class does
    // not prune the ladder: the Primary spends its whole budget (1 + 3).
    expect(result).toEqual([]);
    expect(count(calls, PRIMARY.model)).toBe(4);
  });

  it('keeps the ladder on auth failures in extract (only the merge pool fails fast)', async () => {
    vi.useFakeTimers();
    const { transport, calls } = capture((config) =>
      config.model === BACKUP.model ? { characters: [ALICE] } : classError('auth'),
    );
    const service = createLlmStages(
      baseDeps({
        transport,
        backup: { ...BACKUP },
        extract: { ...PRIMARY, maxRetries: 2 },
        assign: { ...PRIMARY, maxRetries: 2 },
        merge: { ...PRIMARY, maxRetries: 2 },
      }),
    );

    const pending = service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(count(calls, PRIMARY.model)).toBe(3);
    expect(count(calls, BACKUP.model)).toBe(2);
    expect(result.map((c) => c.canonicalName)).toEqual(['Alice']);
  });

  it('spends no primary retry on deterministic failures; the helper falls through to the backup split', async () => {
    const { transport, calls } = capture((config) =>
      config.model === BACKUP.model ? { characters: [ALICE] } : classError('deterministic'),
    );
    const service = createLlmStages(baseDeps({ transport, backup: { ...BACKUP } }));

    const result = await service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));

    expect(count(calls, PRIMARY.model)).toBe(1);
    expect(count(calls, BACKUP.model)).toBe(2);
    expect(result.map((c) => c.canonicalName)).toEqual(['Alice']);
    // The fallback log names the class and the rejecting provider; the
    // deterministic helper spent zero retries, so no false "exhausted" count.
    const fallbackWarn = warn.mock.calls
      .map((args) => args[0] as string)
      .find((msg) => msg.includes('falling back to backup model'));
    expect(fallbackWarn).toContain('deterministic');
    expect(fallbackWarn).toContain(PRIMARY.apiUrl);
  });

  it('aborts the vote pool after two auth failures even with a timeout between them, and degrades with one actionable warning', async () => {
    let call = 0;
    const { transport, calls } = capture(() => {
      call++;
      if (call % 2 === 0) return classError('transport');
      return classError('auth');
    });
    const service = createLlmStages(baseDeps({ transport }));
    const chars = [ALICE, ALICIA];

    const result = await service.merge(chars);

    expect(result).toEqual(chars);
    // One actionable burst warning; per-vote failures log separately.
    const burstWarnings = warn.mock.calls
      .map((args) => args[0] as string)
      .filter((msg) => msg.includes('Vote pool aborted'));
    expect(burstWarnings).toHaveLength(1);
    expect(burstWarnings[0]).toContain(PRIMARY.apiUrl);
    expect(burstWarnings[0]).toContain(PRIMARY.model);
    expect(burstWarnings[0]).toContain('/5 votes');
    // Workers aborted by the latch settle late: their settles must not surface
    // as "replacing with a fresh temperature". The only legitimate one is the
    // transport failure that sat between the two auth failures.
    expect(
      warn.mock.calls.filter((args) =>
        (args[0] as string).includes('replacing with a fresh temperature'),
      ),
    ).toHaveLength(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
    // The latch fired on the third failure (auth, timeout, auth): the pool
    // stops instead of draining the replacement-temperature budget.
    expect(calls.length).toBeLessThanOrEqual(defaultConfig.llm.mergeVoteCount * 2);
  });

  it('logs one compact warn on a single auth vote failure and completes the pool on later successes', async () => {
    let call = 0;
    const { transport } = capture(() => {
      call++;
      if (call === 1) return classError('auth');
      return { reasoning: 'ok', merges: [[0, 1]] };
    });
    const service = createLlmStages(baseDeps({ transport, merge: { ...PRIMARY, maxRetries: 1 } }));

    const result = await service.merge([ALICE, ALICIA, BOB]);

    expect(result).toHaveLength(2); // consensus ran on the full quota
    // The auth failure must not vanish silently before the latch can matter.
    const authWarns = warn.mock.calls
      .map((args) => args[0] as string)
      .filter((msg) => msg.includes('Auth vote failure'));
    expect(authWarns).toHaveLength(1);
    expect(authWarns[0]).toContain('temp=');
    expect(authWarns[0]).toContain('auth');
  });

  it('never reports a backup split retry past the configured limit', async () => {
    vi.useFakeTimers();
    const { transport } = capture((config) =>
      config.model === BACKUP.model ? classError('transport') : new Error('primary dead'),
    );
    const service = createLlmStages(baseDeps({ transport, backup: { ...BACKUP, maxRetries: 2 } }));

    const pending = service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));
    await vi.runAllTimersAsync();
    await pending.catch(() => {}); // both halves exhaust; the block degrades

    const labels = warn.mock.calls
      .map((args) => args[0] as string)
      .map((msg) => /Backup split retry (\d+)\/2:/.exec(msg)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    expect(labels.length).toBeGreaterThan(0);
    expect(Math.max(...labels)).toBe(2); // last attempt reads N/N
    expect(labels).not.toContain(3); // never N+1/N
  });

  it('records model, temperature, top_p, max_tokens and the streaming flag in every pass request dump', async () => {
    const savePhaseLog = vi.spyOn(DebugLogger.prototype, 'savePhaseLog').mockResolvedValue();
    // Route on the stage tag so primary/merge share one model here.
    const transport: NonNullable<LlmStageDeps['transport']> = async (_config, opts) => {
      if (opts.stage === 'extract') return { reasoning: 'ok', characters: [ALICE] } as never;
      if (opts.stage === 'qa') return { reasoning: 'ok', assignments: { '0': 'A' } } as never;
      if (opts.stage === 'merge') return { reasoning: 'ok', merges: [[0, 1]] } as never;
      return { reasoning: 'ok', assignments: { '0': 'A' } } as never;
    };
    let nextCode = 0;
    const service = createLlmStages(
      baseDeps({
        transport,
        useVoting: true,
        speakerCodeFactory: () => ['A', 'B', 'C', 'D'][nextCode++] ?? 'X9',
        extract: { ...PRIMARY, temperature: 0.4, topP: 0.9 },
        assign: { ...PRIMARY, temperature: 0.4, topP: 0.9, streaming: true },
        merge: { ...PRIMARY, temperature: 0.4, topP: 0.9 },
      }),
    );

    await service.extract(block(['Alice here.', 'Alice there.', 'Alice too.']));
    await service.assign(block(['"Hi," said Alice.']), new Map(), [ALICE]);
    await service.merge([ALICE, ALICIA]);

    const dump = (phase: string) => {
      const call = savePhaseLog.mock.calls.find((c) => c[0] === phase);
      expect(call, `no ${phase} dump`).toBeDefined();
      return call![1] as Record<string, unknown>;
    };

    for (const phase of ['extract', 'assign_draft', 'assign_qa', 'merge']) {
      const body = dump(phase);
      expect(body.model, phase).toBe(PRIMARY.model);
      expect(body.temperature, phase).toEqual(expect.any(Number));
      expect(body.top_p, phase).toBe(0.9);
      expect(body.max_tokens, phase).toBe(defaultConfig.llm.maxTokens);
      expect(body.stream, phase).toEqual(expect.any(Boolean));
      expect(Array.isArray(body.messages), phase).toBe(true);
    }
    expect(dump('assign_draft').stream).toBe(true); // flag comes from the stage config
    expect(dump('merge').stream).toBe(false); // votes never stream
  });
});
