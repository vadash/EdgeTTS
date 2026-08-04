import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import { LLMVoiceService } from '../llm/LLMVoiceService';
import type { AssignContext } from '../llm/PromptStrategy';
import type { LLMCharacter, TextBlock } from '@/state/types';
import type { StructuredCallOptions } from '../llm/schemaUtils';
import extractFixture from '../../test/fixtures/llm-real-data/extract_request.json';
import assignFixture from '../../test/fixtures/llm-real-data/assign_request.json';

vi.mock('openai', () => ({ default: vi.fn() }));

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeService(withBackup: boolean, useVoting = false) {
  return new LLMVoiceService({
    apiKey: 'primary-key',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    narratorVoice: 'narrator',
    logger: mockLogger,
    useVoting,
    backupConfig: withBackup
      ? {
          apiKey: 'backup-key',
          apiUrl: 'https://backup.api.com/v1',
          model: 'backup-model',
          maxRetries: 3,
        }
      : undefined,
  });
}
// callWithStageBackup is private; expose it for testing
type CallWithStageBackup = <T>(
  stage: 'extract' | 'assign',
  client: unknown,
  args: unknown,
  signal: AbortSignal | undefined,
  onRetry: (a: number, e: unknown) => void,
) => Promise<T>;
const getCallWithStageBackup = (s: LLMVoiceService): CallWithStageBackup =>
  (s as unknown as { callWithStageBackup: CallWithStageBackup }).callWithStageBackup.bind(s);

describe('LLMVoiceService - Backup fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to backup model when primary exhausts retries', async () => {
    const service = makeService(true);

    // Primary rejects, backup succeeds
    vi.spyOn(service.apiClient, 'callStructured').mockRejectedValue(new Error('rate limit'));
    vi.spyOn(service.backupApiClient!, 'callStructured').mockResolvedValue({
      characters: [{ canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }],
    } as never);

    const result = await getCallWithStageBackup(service)(
      'extract',
      service.apiClient,
      { messages: [], schema: {}, schemaName: 'Test' },
      undefined,
      () => {},
    );

    expect(result).toEqual({
      characters: [{ canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }],
    });
    expect(service.apiClient.callStructured).toHaveBeenCalledTimes(1);
    expect(service.backupApiClient!.callStructured).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('rethrows original error when no backup is configured', async () => {
    const service = makeService(false);

    vi.spyOn(service.apiClient, 'callStructured').mockRejectedValue(new Error('primary down'));
    expect(service.backupApiClient).toBeNull();

    await expect(
      getCallWithStageBackup(service)(
        'extract',
        service.apiClient,
        { messages: [], schema: {}, schemaName: 'Test' },
        undefined,
        () => {},
      ),
    ).rejects.toThrow('primary down');

    expect(service.apiClient.callStructured).toHaveBeenCalledTimes(1);
  });

  it('falls back to backup when primary maxRetries is 0 (one try, then backup)', async () => {
    const service = new LLMVoiceService({
      apiKey: 'primary-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator',
      logger: mockLogger,
      maxRetries: 0,
      backupConfig: {
        apiKey: 'backup-key',
        apiUrl: 'https://backup.api.com/v1',
        model: 'backup-model',
        maxRetries: 0,
      },
    });

    // Primary rejects once; backup succeeds.
    vi.spyOn(service.apiClient, 'callStructured').mockRejectedValue(new Error('boom'));
    vi.spyOn(service.backupApiClient!, 'callStructured').mockResolvedValue({
      characters: [{ canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }],
    } as never);

    const result = await getCallWithStageBackup(service)(
      'extract',
      service.apiClient,
      { messages: [], schema: {}, schemaName: 'Test' },
      undefined,
      () => {},
    );

    expect(result).toEqual({
      characters: [{ canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }],
    });
    // Primary got its single attempt, then the backup model took over.
    expect(service.apiClient.callStructured).toHaveBeenCalledTimes(1);
    expect(service.backupApiClient!.callStructured).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('does not fall back when signal is already aborted', async () => {
    const service = makeService(true);

    vi.spyOn(service.apiClient, 'callStructured').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const backupSpy = vi.spyOn(service.backupApiClient!, 'callStructured');

    const controller = new AbortController();
    controller.abort();

    await expect(
      getCallWithStageBackup(service)(
        'extract',
        service.apiClient,
        { messages: [], schema: {}, schemaName: 'Test' },
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow();

    // Backup should never be called because the signal was already aborted
    expect(backupSpy).not.toHaveBeenCalled();
  });

  it('splits a real extract block into two backup calls and merges characters', async () => {
    const service = makeService(true);
    const realText = extractFixture.messages
      .find((m) => m.role === 'user')!
      .content.match(/<input_text>\n([\s\S]*?)<\/input_text>/)![1];
    const captured: string[] = [];
    vi
      .spyOn(service.backupApiClient!, 'callStructured')
      .mockImplementation((args: StructuredCallOptions<unknown>) => {
        const body = args.messages.map((m) => m.content).join('\n');
        captured.push(body.match(/<input_text>\n([\s\S]*?)<\/input_text>/)?.[1] ?? '');
        return Promise.resolve({
          characters: [{ canonicalName: 'Bob', variations: ['Bob'], gender: 'male' }],
          reasoning: null,
        });
      }) as never;

    const split = (
      service as unknown as {
        extractBackupSplit: (t: string, s?: AbortSignal) => Promise<{ characters: unknown[] }>;
      }
    ).extractBackupSplit.bind(service);

    const result = await split(realText);

    expect(service.backupApiClient!.callStructured).toHaveBeenCalledTimes(2);
    // Halves partition the original block: no overlap, no loss.
    const total = realText.split('\n').filter((l) => l.length > 0).length;
    const h0 = captured[0].split('\n').filter((l) => l.length > 0).length;
    const h1 = captured[1].split('\n').filter((l) => l.length > 0).length;
    expect(h0 + h1).toBe(total);
    expect(h0).toBeGreaterThan(0);
    expect(h1).toBeGreaterThan(0);
    // Characters from both halves concatenate.
    expect(result.characters).toHaveLength(2);
  });

  it('splits real assign paragraphs: renumbers second half, offsets keys back on merge', async () => {
    const service = makeService(true);
    const realParagraphs = assignFixture.messages
      .find((m) => m.role === 'user')!
      .content.match(/<numbered_paragraphs>\n([\s\S]*?)<\/numbered_paragraphs>/)![1];
    vi
      .spyOn(service.backupApiClient!, 'callStructured')
      .mockImplementation((args: StructuredCallOptions<unknown>) => {
        const body = args.messages.map((m) => m.content).join('\n');
        // First half keeps the original [0] line; second half is renumbered to [0].
        const isFirstHalf = body.includes('[0] Story written by Sinnoa');
        return Promise.resolve({
          assignments: { '0': isFirstHalf ? 'A' : 'B' },
          reasoning: null,
        });
      }) as never;

    const context: AssignContext = {
      characters: [],
      nameToCode: new Map<string, string>(),
      codeToName: new Map<string, string>(),
      numberedParagraphs: realParagraphs,
      sentenceCount: 0,
    };
    const split = (
      service as unknown as {
        assignBackupSplit: (
          c: AssignContext,
          o: string[] | undefined,
          s?: AbortSignal,
        ) => Promise<{ assignments: Record<string, string> }>;
      }
    ).assignBackupSplit.bind(service);

    const result = await split(context, undefined);

    expect(service.backupApiClient!.callStructured).toHaveBeenCalledTimes(2);
    // First-half [0] -> 'A'. Second-half renumbered [0] -> 'B', shifted by first-half count.
    expect(result.assignments['0']).toBe('A');
    const offset = Math.ceil(realParagraphs.split('\n').length / 2);
    expect(result.assignments[String(offset)]).toBe('B');
  });

  it('QA pass retries the primary only and never falls back to the backup model', async () => {
    const service = makeService(true, true); // backup configured + voting enabled
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    let callCount = 0;
    // Draft (call 1) succeeds on primary; every later call (QA) fails on primary.
    vi.spyOn(service.apiClient, 'callStructured').mockImplementation((() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ assignments: { '0': 'A' }, reasoning: null });
      }
      return Promise.reject(new Error('QA down'));
    }) as never);
    const backupSpy = vi.spyOn(service.backupApiClient!, 'callStructured');

    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['"Hi," said Alice.'] },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // QA must never touch the backup model — only the primary is retried.
    expect(backupSpy).not.toHaveBeenCalled();
    // Draft ran, then QA was attempted on the primary (and failed there).
    expect(callCount).toBeGreaterThan(1);
    expect(result).toHaveLength(1);
  });
});
