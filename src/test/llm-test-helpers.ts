import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from '@/services/Logger';
import { createLlmStages, type LlmStages } from '@/services/llm/stages';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
import { testConfig } from '../../test.config.local';
import type { ExpectedDialogue } from './fixtures';
import { speakerMatchesCharacter } from './fixtures';

const testLogger: ILogger = {
  debug: (message: string, data?: Record<string, unknown>) =>
    console.log(`[DEBUG] ${message}`, data || ''),
  info: (message: string, data?: Record<string, unknown>) =>
    console.log(`[INFO] ${message}`, data || ''),
  warn: (message: string, data?: Record<string, unknown>) =>
    console.warn(`[WARN] ${message}`, data || ''),
  error: (message: string, error?: Error, data?: Record<string, unknown>) =>
    console.error(`[ERROR] ${message}`, error, data || ''),
};

export interface ExtractResult {
  characters: LLMCharacter[];
  blockCount: number;
  durationMs: number;
}

export interface AssignResult {
  assignments: SpeakerAssignment[];
  blockCount: number;
  dialogueCount: number;
  durationMs: number;
}

export interface DialogueCheckResult {
  expected: ExpectedDialogue;
  found: boolean;
  actualSpeaker: string | null;
  matched: boolean;
  text: string | null;
}

export function validateConfig(): void {
  if (!testConfig.apiKey || !testConfig.apiUrl || !testConfig.model) {
    throw new Error(
      'Please populate test.config.local.ts with apiKey, apiUrl, and model before running real API tests',
    );
  }
}

export function getRepeatPrompt(): boolean {
  const envVal = process.env.REPEAT_PROMPT;
  if (envVal === undefined || envVal === '') {
    return false;
  }
  return envVal === 'true' || envVal === '1';
}

/**
 * Read the USE_QA env var, which overrides useVoting (the Assign QA pass).
 * Unset or empty falls back to testConfig.useVoting.
 */
export function getUseQA(): boolean {
  const envVal = process.env.USE_QA;
  if (envVal === undefined || envVal === '') {
    return testConfig.useVoting;
  }
  return envVal === 'true' || envVal === '1';
}

/**
 * Create LLM stages wired to the real API config
 * @param repeatPrompt - Optional override for repeatPrompt (defaults to REPEAT_PROMPT env var)
 */
export function createService(repeatPrompt?: boolean): LlmStages {
  validateConfig();
  const stageConfig = () => ({
    apiKey: testConfig.apiKey,
    apiUrl: testConfig.apiUrl,
    model: testConfig.model,
    streaming: testConfig.streaming ?? true,
    reasoning: testConfig.reasoning ? ('auto' as const) : null,
    temperature: testConfig.temperature,
    repeatPrompt: repeatPrompt ?? getRepeatPrompt(),
  });
  return createLlmStages({
    extract: stageConfig(),
    assign: stageConfig(),
    merge: stageConfig(),
    narratorVoice: 'en-US-AriaNeural',
    llmThreads: 2,
    useVoting: getUseQA(),
    directoryHandle: null,
    logger: testLogger,
  });
}

export function createSplitter(): TextBlockSplitter {
  return new TextBlockSplitter();
}

export function loadFixtureText(filename: string): string {
  const fixturePath = path.resolve(__dirname, 'fixtures', filename);
  return fs.readFileSync(fixturePath, 'utf-8');
}

export async function runExtract(
  service: LlmStages,
  splitter: TextBlockSplitter,
  text: string,
  verbose = true,
): Promise<ExtractResult> {
  const blocks = splitter.createExtractBlocks(text);

  if (verbose) {
    console.log(`  Extract: Processing ${blocks.length} block(s)...`);
  }

  const startTime = Date.now();
  const characters = await service.extract(blocks, {
    onProgress: (current, total) => {
      if (verbose) {
        console.log(`    Block ${current}/${total}`);
      }
    },
  });
  const durationMs = Date.now() - startTime;

  return {
    characters,
    blockCount: blocks.length,
    durationMs,
  };
}

export async function runAssign(
  service: LlmStages,
  splitter: TextBlockSplitter,
  text: string,
  characters: LLMCharacter[],
  verbose = true,
): Promise<AssignResult> {
  const blocks = splitter.createAssignBlocks(text);

  const characterVoiceMap = new Map<string, string>();
  characters.forEach((char, i) => {
    characterVoiceMap.set(char.canonicalName, `voice-${i}`);
  });

  if (verbose) {
    console.log(`  Assign: Processing ${blocks.length} block(s)...`);
  }

  const startTime = Date.now();
  const assignments = await service.assign(blocks, characterVoiceMap, characters, {
    onProgress: (current, total) => {
      if (verbose) {
        console.log(`    Block ${current}/${total}`);
      }
    },
  });
  const durationMs = Date.now() - startTime;

  const dialogueCount = assignments.filter((a) => a.speaker !== 'narrator').length;

  return {
    assignments,
    blockCount: blocks.length,
    dialogueCount,
    durationMs,
  };
}

/**
 * Normalize quotes for text matching (smart quotes -> straight quotes)
 */
function normalizeQuotes(text: string): string {
  return (
    text
      // Double quotes
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
      // Single quotes/apostrophes (right single quote is most common apostrophe)
      .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u02BC\u2032\uFF07]/g, "'")
      // Em dash, horizontal bar, and minus signs become a hyphen
      .replace(/[\u2014\u2015\u2212]/g, '-')
  );
}

/**
 * Find assignment by text content (normalizes quotes for matching)
 */
export function findAssignment(
  assignments: SpeakerAssignment[],
  textContains: string,
): SpeakerAssignment | undefined {
  const normalizedSearch = normalizeQuotes(textContains);
  return assignments.find((a) => normalizeQuotes(a.text).includes(normalizedSearch));
}

/**
 * Check dialogue line attribution
 * Uses character variations/aliases for matching when characters are provided
 */
export function checkDialogue(
  assignments: SpeakerAssignment[],
  expected: ExpectedDialogue,
  characters?: LLMCharacter[],
): DialogueCheckResult {
  const assignment = findAssignment(assignments, expected.textContains);

  if (!assignment) {
    return {
      expected,
      found: false,
      actualSpeaker: null,
      matched: false,
      text: null,
    };
  }

  let matched: boolean;
  if (characters && characters.length > 0) {
    matched = speakerMatchesCharacter(assignment.speaker, expected.speaker, characters);
  } else {
    const actualLower = assignment.speaker.toLowerCase();
    const expectedLower = expected.speaker.toLowerCase();
    matched = actualLower.includes(expectedLower) || expectedLower.includes(actualLower);
  }

  return {
    expected,
    found: true,
    actualSpeaker: assignment.speaker,
    matched,
    text: assignment.text,
  };
}

export function logExtractResults(result: ExtractResult): void {
  console.log('\n  === Extract Results ===');
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Characters found: ${result.characters.length}`);
  result.characters.forEach((c) => {
    console.log(`    - ${c.canonicalName} (${c.gender})`);
    if (c.variations.length > 1) {
      console.log(`      Variations: ${c.variations.join(', ')}`);
    }
  });
}

export function logAssignResults(result: AssignResult): void {
  console.log('\n  === Assign Results ===');
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Total sentences: ${result.assignments.length}`);
  console.log(`  Dialogue sentences: ${result.dialogueCount}`);

  const bySpeaker = new Map<string, number>();
  result.assignments.forEach((a) => {
    bySpeaker.set(a.speaker, (bySpeaker.get(a.speaker) || 0) + 1);
  });

  console.log('  By speaker:');
  Array.from(bySpeaker.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([speaker, count]) => {
      console.log(`    - ${speaker}: ${count}`);
    });
}

export function logDialogueChecks(results: DialogueCheckResult[]): void {
  console.log('\n  === Dialogue Attribution Checks ===');

  let passed = 0;
  let failed = 0;
  let notFound = 0;

  results.forEach((r) => {
    const status = !r.found ? '❓' : r.matched ? '✓' : '✗';
    const marker = r.expected.strict ? '[STRICT]' : '[lenient]';

    if (!r.found) {
      console.log(
        `  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." - NOT FOUND`,
      );
      notFound++;
    } else if (r.matched) {
      console.log(
        `  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." -> ${r.actualSpeaker} (expected: ${r.expected.speaker})`,
      );
      passed++;
    } else {
      console.log(
        `  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." -> ${r.actualSpeaker} (expected: ${r.expected.speaker})`,
      );
      failed++;
    }
  });

  console.log(`\n  Summary: ${passed} passed, ${failed} failed, ${notFound} not found`);
}

/**
 * Speakers the Assign pass can emit besides the extracted characters:
 * the narrator plus the unnamed labels for dialogue it cannot attribute
 */
export function getValidSpeakers(canonicalNames: string[]): Set<string> {
  return new Set([
    'narrator',
    ...canonicalNames,
    'MALE_UNNAMED',
    'FEMALE_UNNAMED',
    'UNKNOWN_UNNAMED',
  ]);
}
