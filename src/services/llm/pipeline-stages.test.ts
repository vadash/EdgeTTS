import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@/services/Logger';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';
import type { LLMClientConfig, LLMVoiceServiceOptions } from './LLMVoiceService';
import { AssignSchema, ExtractSchema, MergeSchema } from './schemas';
import type { StructuredCallOptions } from './schemaUtils';

// Real LLM request capture from an actual Infinite Regressor conversion. The
// `messages` block is exactly what the pipeline built on the wire; we replay it
// against the injected transport to exercise the stage fallback behaviour
// without network. Files are git-added under src/test/fixtures/llm-real-data/.
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
type TransportCall = { config: LLMClientConfig; opts: CallArg };
type Transport = NonNullable<LLMVoiceServiceOptions['transport']>;
type TransportBehavior = 'reject' | object;

// Injected transport stub: primary/merge vs backup behaviour is routed by
// config.model (the resolved stage config the service hands to the seam),
// and every call is captured for wire-shape and routing assertions.
function makeTransport(primary: TransportBehavior, backup: TransportBehavior = 'reject') {
  const calls: TransportCall[] = [];
  const transport: Transport = async (config, opts) => {
    calls.push({ config, opts });
    if (config.model === backupOpts.model) {
      if (backup === 'reject') throw BACKUP_REJECT;
      return backup as never;
    }
    if (primary === 'reject') throw PRIMARY_REJECT;
    return primary as never;
  };
  return { transport, calls };
}

function modelCalls(calls: TransportCall[], model: string): CallArg[] {
  return calls.filter((c) => c.config.model === model).map((c) => c.opts);
}

describe('LLMVoiceService - per-stage fallback (real request data)', () => {
  let service: LLMVoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------- extract

  it('extract: primary succeeds -> returns characters from that block, no backup call', async () => {
    const { transport, calls } = makeTransport(EXTRACT_OK);
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });
    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['Line one.', 'Line two.'] },
    ];
    const result = await service.extractCharacters(blocks);

    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(false);
    expect(Array.isArray(result)).toBe(true);
  });

  it('extract: primary exhausted -> falls back to backup (backup succeeds)', async () => {
    const { transport, calls } = makeTransport('reject', EXTRACT_OK);
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

    const blocks: TextBlock[] = [
      { blockIndex: 0, sentenceStartIndex: 0, sentences: ['Line one.'] },
    ];
    await service.extractCharacters(blocks);

    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to backup model (backup-model)'),
    );
  });

  it('extract: main + backup both fail -> block skipped (empty characters), no throw', async () => {
    const { transport } = makeTransport('reject', 'reject');
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

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
    const { transport, calls } = makeTransport(EXTRACT_OK);
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: loadUserContent('extract_request.json').split('\n'),
      },
    ];
    await service.extractCharacters(blocks).catch(() => {});
    const wire = modelCalls(calls, baseOpts.model);
    expect(wire[0].schema).toBe(ExtractSchema);
    expect(wire[0].schemaName).toBe('ExtractSchema');
    expect(wire[0].messages[0].role).toBe('system');
    expect(wire[0].messages[1].role).toBe('user');
  });

  // --------------------------------------------------------------------- assign

  it('assign: primary succeeds -> speakers assigned, no backup call', async () => {
    const { transport, calls } = makeTransport(ASSIGN_OK);
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: ['"Hi," said Undertaker.', '"Hey," said Adele.'],
      },
    ];
    const result = await service.assignSpeakers(blocks, new Map(), characters);
    expect(result).toHaveLength(2);
    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(false);
  });

  it('assign: main + backup both fail -> all sentences fall back to narrator', async () => {
    const { transport } = makeTransport('reject', 'reject');
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

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
    const { transport, calls } = makeTransport(ASSIGN_OK);
    service = new LLMVoiceService({ ...baseOpts, backupConfig: { ...backupOpts }, transport });

    const blocks: TextBlock[] = [
      {
        blockIndex: 0,
        sentenceStartIndex: 0,
        sentences: loadUserContent('assign_request.json').split('\n'),
      },
    ];
    await service.assignSpeakers(blocks, new Map(), characters).catch(() => {});
    const wire = modelCalls(calls, baseOpts.model);
    expect(wire[0].schema).toBe(AssignSchema);
    expect(wire[0].schemaName).toBe('AssignSchema');
  });

  // ----------------------------------------------------------------------- merge

  it('merge: never falls back to backup — failed votes are skipped (no backup call)', async () => {
    const { transport, calls } = makeTransport('reject');
    service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 5,
      },
      backupConfig: { ...backupOpts },
      transport,
    });

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
    ];
    const result = await service.mergeCharacters(chars);

    expect(result).toEqual(chars); // consensus with no votes returns the input
    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Only 0/5 votes survived'),
    );
  });

  it('merge: every successful vote uses MergeSchema; union filter runs after gather', async () => {
    const { transport, calls } = makeTransport(MERGE_OK);
    service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 5,
      },
      backupConfig: { ...backupOpts },
      transport,
    });

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
      { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
    ];
    const result = await service.mergeCharacters(chars);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.opts.schema).toBe(MergeSchema);
      expect(c.opts.schemaName).toBe('MergeSchema');
    }
    // Every vote agrees on merging Alice+Alicia; the union filter runs after
    // the gather, leaving the merged character plus Bob.
    expect(result).toHaveLength(2);
    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(false);
  });

  it('merge: maxRetries=0 means no replacement budget — exactly 5 vote attempts', async () => {
    const { transport, calls } = makeTransport(MERGE_OK);
    service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 0,
      },
      backupConfig: { ...backupOpts },
      transport,
    });

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
    ];
    await service.mergeCharacters(chars);

    // budget = 5 × (1 + 0) = 5 temps; every vote succeeds, so exactly 5 calls
    // — no replacement budget, no retries.
    expect(calls.length).toBe(5);
  });
});

// ----------------------------------------------------------------- transport seam

describe('LLMVoiceService - public mergeCharacters via injected transport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merge: public mergeCharacters merges Alice+Alicia via MergeSchema votes, no backup calls', async () => {
    const calls: TransportCall[] = [];
    const transport: Transport = async (config, opts) => {
      calls.push({ config, opts });
      return MERGE_OK as never;
    };
    const service = new LLMVoiceService({
      ...baseOpts,
      mergeConfig: {
        apiKey: 'merge-key',
        apiUrl: 'https://merge.api.com/v1',
        model: 'merge-model',
        maxRetries: 5,
      },
      backupConfig: { ...backupOpts },
      transport,
    });

    const chars: LLMCharacter[] = [
      { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
      { canonicalName: 'Alicia', variations: ['Alicia'], gender: 'female' },
      { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
    ];
    const result = await service.mergeCharacters(chars);

    // Every vote agrees on merging Alice+Alicia; Bob stays separate.
    expect(result).toHaveLength(2);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.opts.schemaName).toBe('MergeSchema');
      // Votes carry the merge stage's config, never the backup model's.
      expect(c.config.model).toBe('merge-model');
    }
    expect(calls.some((c) => c.config.model === backupOpts.model)).toBe(false);
  });
});
