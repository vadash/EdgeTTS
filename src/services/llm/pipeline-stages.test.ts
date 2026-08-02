import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';
import type { StructuredCallOptions } from './schemaUtils';

// Real LLM request capture from an actual Infinite Regressor conversion. The
// `messages` block is exactly what the pipeline built on the wire; we replay it
// against a mocked api client to exercise the stage fallback behaviour without
// network. Files are git-added under src/test/fixtures/llm-real-data/.
const FIXTURES = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'test',
  'fixtures',
  'llm-real-data',
);

function loadUserContent(file: string): string {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf-8')) as {
    messages: Array<{ role: string; content: string }>;
  };
  return raw.messages[1].content;
}

const PRIMARY_REJECT = new Error('primary failed');
const BACKUP_REJECT = new Error('backup failed');
const MERGE_REJECT = new Error('merge failed');

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));

const mockLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseOpts = {
  apiKey: 'primary-key',
  apiUrl: 'https://api.openai.com/v1',
  model: 'primary-model',
  narratorVoice: 'narrator-voice',
  logger: mockLogger,
  maxRetries: 3,
};

const backupOpts = {
  apiKey: 'backup-key',
  apiUrl: 'https://backup.api.com/v1',
  model: 'backup-model',
  maxRetries: 2,
};

// Canned successful responses shaped to satisfy the stage schemas.
const EXTRACT_OK = {
  reasoning: 'ok',
  characters: [
    { canonicalName: 'Undertaker', variations: ['Undertaker'], gender: 'male' as const },
    { canonicalName: 'Adele', variations: ['Adele'], gender: 'female' as const },
  ],
};
const ASSIGN_OK = { reasoning: 'ok', assignments: { '0': 'A', '1': 'B' } };
const MERGE_OK = { reasoning: 'ok', merges: [[0, 1]] };

const characters: LLMCharacter[] = [
  { canonicalName: 'Undertaker', variations: ['Undertaker'], gender: 'male' },
  { canonicalName: 'Adele', variations: ['Adele'], gender: 'female' },
];

type CallArg = StructuredCallOptions<unknown>;

function mockPrimary(service: LLMVoiceService, result: 'reject' | object): void {
  const fn = vi.spyOn(service.apiClient, 'callStructured');
  if (result === 'reject') fn.mockRejectedValue(PRIMARY_REJECT);
  else fn.mockResolvedValue(result as never);
}

function mockBackup(service: LLMVoiceService, result: 'reject' | object): void {
  if (!service.backupApiClient) return;
  const fn = vi.spyOn(service.backupApiClient, 'callStructured');
  if (result === 'reject') fn.mockRejectedValue(BACKUP_REJECT);
  else fn.mockResolvedValue(result as never);
}

function mockMerge(service: LLMVoiceService, result: 'reject' | object): void {
  const fn = vi.spyOn(service.mergeApiClient, 'callStructured');
  if (result === 'reject') fn.mockRejectedValue(MERGE_REJECT);
  else fn.mockResolvedValue(result as never);
}

function primaryCalls(service: LLMVoiceService): CallArg[] {
  const fn = vi.mocked(service.apiClient.callStructured);
  return fn.mock.calls.map((c) => c[0] as unknown as CallArg);
}

function mergeCalls(service: LLMVoiceService): CallArg[] {
  const fn = vi.mocked(service.mergeApiClient.callStructured);
  return fn.mock.calls.map((c) => c[0] as unknown as CallArg);
}

describe('LLMVoiceService - per-stage fallback (real request data)', () => {
  let service: LLMVoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------- extract

  it('extract: primary succeeds -> returns characters from that block, no backup call', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, EXTRACT_OK);
    vi.spyOn(service.backupApiClient!, 'callStructured');
    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['Line one.', 'Line two.'] },
    ];
    const result = await service.extractCharacters(blocks);

    expect(service.backupApiClient!.callStructured).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });

  it('extract: primary exhausted -> falls back to backup (backup succeeds)', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, 'reject');
    mockBackup(service, EXTRACT_OK);

    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['Line one.'] },
    ];
    await service.extractCharacters(blocks);

    expect(service.backupApiClient!.callStructured).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('extract: main + backup both fail -> block skipped (empty characters), no throw', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, 'reject');
    mockBackup(service, 'reject');

    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['Line one.', 'Line two.'] },
      { blockIndex: 1, sentenceStartIndex: 2, sentences: ['Line three.'] },
    ];
    const result = await service.extractCharacters(blocks);
    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed after all retries, skipping'),
    );
  });

  it('extract: real Infinite Regressor request uses ExtractSchema wire shape', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, EXTRACT_OK);

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: loadUserContent('extract_request.json').split('\n'),
      },
    ];
    await service.extractCharacters(blocks).catch(() => {});
    const calls = primaryCalls(service);
    expect(calls[0].schema).toBe(ExtractSchema);
    expect(calls[0].schemaName).toBe('ExtractSchema');
    expect(calls[0].messages[0].role).toBe('system');
    expect(calls[0].messages[1].role).toBe('user');
  });

  // --------------------------------------------------------------------- assign

  it('assign: primary succeeds -> speakers assigned, no backup call', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, ASSIGN_OK);

    vi.spyOn(service.backupApiClient!, 'callStructured');
    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hi," said Undertaker.', '"Hey," said Adele.'],
      },
    ];
    const result = await service.assignSpeakers(blocks, new Map(), characters);
    expect(result).toHaveLength(2);
    expect(service.backupApiClient!.callStructured).not.toHaveBeenCalled();
  });

  it('assign: main + backup both fail -> all sentences fall back to narrator', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, 'reject');
    mockBackup(service, 'reject');

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hi," said Undertaker.', '"Hey," said Adele.', 'Narration here.'],
      },
    ];
    const result = await service.assignSpeakers(blocks, new Map(), characters);
    expect(result).toHaveLength(3);
    expect(result.every((a) => a.speaker === 'narrator')).toBe(true);
    expect(result.every((a) => a.voiceId === 'narrator-voice')).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed after all retries, using default voice'),
    );
  });

  it('assign: real Infinite Regressor request uses AssignSchema wire shape', async () => {
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts } });
    mockPrimary(service, ASSIGN_OK);

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: loadUserContent('assign_request.json').split('\n'),
      },
    ];
    await service.assignSpeakers(blocks, new Map(), characters).catch(() => {});
    const calls = primaryCalls(service);
    expect(calls[0].schema).toBe(AssignSchema);
    expect(calls[0].schemaName).toBe('AssignSchema');
  });

  // ----------------------------------------------------------------------- merge

  it('merge: never falls back to backup — failed votes are skipped (no backup call)', async () => {
    service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 5,
      },
      backupConfig: { ...backupOpts },
    });
    mockMerge(service, 'reject');
    vi.spyOn(service.backupApiClient!, 'callStructured');

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
    ];
    const typed = service as unknown as {
      mergeCharactersWithLLM: (c: LLMCharacter[]) => Promise<LLMCharacter[]>;
    };
    const result = await typed.mergeCharactersWithLLM(chars);

    expect(result).toEqual(chars); // consensus with no votes returns the input
    expect(service.backupApiClient!.callStructured).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('All 5 votes failed'));
  });

  it('merge: every successful vote uses MergeSchema; union filter runs after gather', async () => {
    service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 5,
      },
      backupConfig: { ...backupOpts },
    });
    mockMerge(service, MERGE_OK);
    vi.spyOn(service.backupApiClient!, 'callStructured');

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
      { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
    ];
    const typed = service as unknown as {
      mergeCharactersWithLLM: (c: LLMCharacter[]) => Promise<LLMCharacter[]>;
    };
    await typed.mergeCharactersWithLLM(chars);

    const calls = mergeCalls(service);
    for (const c of calls) {
      expect(c.schema).toBe(MergeSchema);
      expect(c.schemaName).toBe('MergeSchema');
    }
    expect(service.backupApiClient!.callStructured).not.toHaveBeenCalled();
  });
});
