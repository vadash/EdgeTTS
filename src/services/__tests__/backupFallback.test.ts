import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import { createLlmStages } from '../llm/stages';
import type { LLMClientConfig, LlmStageDeps } from '../llm/stages';
import type { StructuredCallOptions } from '../llm/schemaUtils';
import type { LLMCharacter, TextBlock } from '@/state/types';
import extractFixture from '../../test/fixtures/llm-real-data/extract_request.json';
import assignFixture from '../../test/fixtures/llm-real-data/assign_request.json';

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const PRIMARY_REJECT = new Error('rate limit');
const BACKUP_REJECT = new Error('backup failed');

type TransportCall = { config: LLMClientConfig; opts: StructuredCallOptions<unknown> };

// Injected transport stub: routes by resolved stage config (model field),
// capturing every call. Primary/backup behaviour is chosen per test.
function captureTransport(route: (config: LLMClientConfig) => 'reject' | unknown): {
  transport: NonNullable<LlmStageDeps['transport']>;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: NonNullable<LlmStageDeps['transport']> = async (config, opts) => {
    calls.push({ config, opts });
    const result = route(config);
    if (result === 'reject') {
      throw config.model === 'backup-model' ? BACKUP_REJECT : PRIMARY_REJECT;
    }
    return result as never;
  };
  return { transport, calls };
}

function makeService(withBackup: boolean, overrides: Partial<LlmStageDeps> = {}) {
  return createLlmStages({
    extract: { apiKey: 'primary-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    assign: { apiKey: 'primary-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    merge: { apiKey: 'primary-key', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    narratorVoice: 'narrator',
    llmThreads: 2,
    useVoting: false,
    directoryHandle: null,
    logger: mockLogger,
    backup: withBackup
      ? {
          apiKey: 'backup-key',
          apiUrl: 'https://backup.api.com/v1',
          model: 'backup-model',
          maxRetries: 3,
        }
      : undefined,
    ...overrides,
  });
}

describe('LlmStages - Backup fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to backup model when primary exhausts retries', async () => {
    // Primary rejects, backup succeeds
    const alice = { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' as const };
    const { transport, calls } = captureTransport((config) =>
      config.model === 'backup-model' ? { characters: [alice] } : 'reject',
    );
    const service = makeService(true, { transport });

    const result = await service.extract([
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hi," said Alice.', 'Alice waved.', 'Alice left.'],
      },
    ]);

    expect(result).toEqual([alice]);
    expect(calls.filter((c) => c.config.model === 'gpt-4o-mini')).toHaveLength(1);
    // Primary never splits: the backup replay splits the 3-line block in half.
    expect(calls.filter((c) => c.config.model === 'backup-model')).toHaveLength(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('contains the primary error when no backup is configured (block skipped, no fallback)', async () => {
    const { transport, calls } = captureTransport(() => 'reject');
    const service = makeService(false, { transport });

    const result = await service.extract([
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['"Hi," said Alice.'] },
    ]);

    // No backup: the primary failure degrades to a skipped block — never a
    // fallback call, never a rethrow out of the stage.
    expect(result).toEqual([]);
    expect(calls.filter((c) => c.config.model === 'gpt-4o-mini')).toHaveLength(1);
    expect(calls.filter((c) => c.config.model === 'backup-model')).toHaveLength(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed after all retries, skipping'),
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model'),
    );
  });

  it('falls back to backup when primary maxRetries is 0 (one try, then backup)', async () => {
    const alice = { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' as const };
    const { transport, calls } = captureTransport((config) =>
      config.model === 'backup-model' ? { characters: [alice] } : 'reject',
    );
    const service = createLlmStages({
      extract: {
        apiKey: 'primary-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        maxRetries: 0,
      },
      assign: {
        apiKey: 'primary-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        maxRetries: 0,
      },
      merge: {
        apiKey: 'primary-key',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        maxRetries: 0,
      },
      narratorVoice: 'narrator',
      llmThreads: 2,
      useVoting: false,
      directoryHandle: null,
      logger: mockLogger,
      backup: {
        apiKey: 'backup-key',
        apiUrl: 'https://backup.api.com/v1',
        model: 'backup-model',
        maxRetries: 0,
      },
      transport,
    });

    const result = await service.extract([
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hi," said Alice.', 'Alice waved.', 'Alice left.'],
      },
    ]);

    expect(result).toEqual([alice]);
    // Primary got its single attempt, then the backup model took over
    // (splitting the 3-line block in half).
    expect(calls.filter((c) => c.config.model === 'gpt-4o-mini')).toHaveLength(1);
    expect(calls.filter((c) => c.config.model === 'backup-model')).toHaveLength(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('does not fall back to backup once the signal is aborted', async () => {
    const calls: TransportCall[] = [];
    const controller = new AbortController();
    const service = makeService(true, {
      transport: async (config, opts) => {
        calls.push({ config, opts });
        if (config.model === 'backup-model') throw BACKUP_REJECT;
        // Abort mid-flight so the in-progress primary attempt sees an
        // aborted signal when it fails — an aborted request never backs up.
        controller.abort();
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    });

    await expect(
      service.extract(
        [{ blockIndex: 0, sentenceStartIndex: 0, sentences: ['"Hi," said Alice.'] }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow('aborted');

    // Backup should never be called because the signal was aborted
    expect(calls.some((c) => c.config.model === 'backup-model')).toBe(false);
  });

  it('splits a real extract block into two backup calls and merges characters', async () => {
    const realText = extractFixture.messages
      .find((m) => m.role === 'user')!
      .content.match(/<input_text>\n([\s\S]*?)<\/input_text>/)![1];
    // 'Sinnoa' appears 5 times in the block, so both halves' characters
    // survive the post-extract frequency cull — their variations concatenate.
    let half = 0;
    const { transport, calls } = captureTransport((config) => {
      if (config.model !== 'backup-model') return 'reject';
      half++;
      return {
        characters: [
          {
            canonicalName: 'Sinnoa',
            variations: [half === 1 ? 'Sinnoa' : 'SINNOA'],
            gender: 'male' as const,
          },
        ],
      };
    });
    const service = makeService(true, { transport });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: realText.split('\n'),
      },
    ];
    const result = await service.extract(blocks);

    const backupCalls = calls.filter((c) => c.config.model === 'backup-model');
    expect(backupCalls).toHaveLength(2);
    // Halves partition the original block: no overlap, no loss.
    const total = realText.split('\n').filter((l) => l.length > 0).length;
    const halfBodies = backupCalls.map((c) => c.opts.messages.map((m) => m.content).join('\n'));
    const h0 = halfBodies[0].match(/<input_text>\n([\s\S]*?)<\/input_text>/)![1];
    const h1 = halfBodies[1].match(/<input_text>\n([\s\S]*?)<\/input_text>/)![1];
    const h0Lines = h0.split('\n').filter((l) => l.length > 0).length;
    const h1Lines = h1.split('\n').filter((l) => l.length > 0).length;
    expect(h0Lines + h1Lines).toBe(total);
    expect(h0Lines).toBeGreaterThan(0);
    expect(h1Lines).toBeGreaterThan(0);
    // Characters from both halves concatenate (variations merged on dedupe).
    expect(result).toEqual([
      { canonicalName: 'Sinnoa', variations: ['Sinnoa', 'SINNOA'], gender: 'male' },
    ]);
  });

  it('splits real assign paragraphs: renumbers second half, offsets keys back on merge', async () => {
    const realParagraphs = assignFixture.messages
      .find((m) => m.role === 'user')!
      .content.match(/<numbered_paragraphs>\n([\s\S]*?)<\/numbered_paragraphs>/)![1];
    // Deterministic speaker codes so 'A'/'B' resolve through codeToName:
    // canonicalNames first, then MALE/FEMALE/UNKNOWN_UNNAMED (no characters
    // here, so A=MALE_UNNAMED, B=FEMALE_UNNAMED).
    let nextCode = 0;
    let nextHalf = 0;
    const { transport, calls } = captureTransport((config) => {
      if (config.model !== 'backup-model') return 'reject';
      // First half keeps the original [0] line; second half is renumbered.
      return {
        assignments: { '0': nextHalf++ === 0 ? 'A' : 'B' },
        reasoning: null,
      };
    });
    const service = makeService(true, {
      transport,
      speakerCodeFactory: () => ['A', 'B', 'C', 'D'][nextCode++] ?? 'X9',
    });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: realParagraphs.split('\n'),
      },
    ];
    const result = await service.assign(blocks, new Map(), []);

    const backupCalls = calls.filter((c) => c.config.model === 'backup-model');
    expect(backupCalls).toHaveLength(2);
    // First-half [0] keeps the original line and maps to code 'A'.
    expect(result[0].speaker).toBe('MALE_UNNAMED');
    // Second half is renumbered from [0]; its key shifts back by the first
    // half's length and maps to code 'B'.
    const offset = Math.ceil(realParagraphs.split('\n').length / 2);
    expect(result[offset].speaker).toBe('FEMALE_UNNAMED');
  });

  it('QA pass retries the primary only and never falls back to the backup model', async () => {
    const characters: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    ];
    let callCount = 0;
    // Draft (call 1) succeeds on primary; every later call (QA) fails on primary.
    const { transport, calls } = captureTransport((config) => {
      if (config.model === 'backup-model') return 'reject';
      callCount++;
      if (callCount === 1) {
        return { assignments: { '0': 'A' }, reasoning: null };
      }
      return 'reject';
    });
    // Deterministic codes so 'A' resolves to Alice through codeToName.
    let nextCode = 0;
    const service = makeService(true, {
      transport,
      useVoting: true,
      speakerCodeFactory: () => ['A', 'B', 'C', 'D'][nextCode++] ?? 'X9',
    });

    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['"Hi," said Alice.'] },
    ];

    const result = await service.assign(blocks, new Map(), characters);

    // QA must never touch the backup model — only the primary is retried.
    expect(calls.some((c) => c.config.model === 'backup-model')).toBe(false);
    // Draft ran, then QA was attempted on the primary (and failed there).
    expect(callCount).toBeGreaterThan(1);
    expect(result).toEqual([
      {
        sentenceIndex: 0,
        text: '"Hi," said Alice.',
        speaker: 'Alice',
        voiceId: 'narrator',
      },
    ]);
  });
});
