import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import { LLMVoiceService } from '../llm/LLMVoiceService';

vi.mock('openai', () => ({ default: vi.fn() }));

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeService(withBackup: boolean) {
  return new LLMVoiceService({
    apiKey: 'primary-key',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    narratorVoice: 'narrator',
    logger: mockLogger,
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
// callWithBackup is private; expose it for testing
type CallWithBackup = <T>(
  stage: 'extract',
  client: unknown,
  args: unknown,
  signal: AbortSignal | undefined,
  onRetry: (a: number, e: unknown) => void,
) => Promise<T>;
const getCallWithBackup = (s: LLMVoiceService): CallWithBackup =>
  (s as unknown as { callWithBackup: CallWithBackup }).callWithBackup.bind(s);

describe('LLMVoiceService - Backup fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to backup model when primary exhausts retries', async () => {
    const service = makeService(true);

    // Primary rejects, backup succeeds
    vi.spyOn(service.apiClient, 'callStructured').mockRejectedValue(new Error('rate limit'));
    vi.spyOn(service.backupApiClient!, 'callStructured').mockResolvedValue({
      characters: [{ canonicalName: 'Alice', variations: ['Alice'], gender: 'female' }],
    } as never);

    const result = await getCallWithBackup(service)(
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
      getCallWithBackup(service)(
        'extract',
        service.apiClient,
        { messages: [], schema: {}, schemaName: 'Test' },
        undefined,
        () => {},
      ),
    ).rejects.toThrow('primary down');

    expect(service.apiClient.callStructured).toHaveBeenCalledTimes(1);
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
      getCallWithBackup(service)(
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
});
