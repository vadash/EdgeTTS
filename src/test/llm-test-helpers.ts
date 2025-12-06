import { LLMVoiceService } from '@/services/llm';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { testConfig } from '../../test.config.local';
import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
import type { TestFixture, ExpectedDialogue } from './fixtures';
import { speakerMatchesCharacter } from './fixtures';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test helpers for LLM real API tests
 */

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

/**
 * Validate test config is populated
 */
export function validateConfig(): void {
  if (!testConfig.apiKey || !testConfig.apiUrl || !testConfig.model) {
    throw new Error(
      'Please populate test.config.local.ts with apiKey, apiUrl, and model before running real API tests'
    );
  }
}

/**
 * Create LLMVoiceService instance
 */
export function createService(): LLMVoiceService {
  validateConfig();
  return new LLMVoiceService({
    apiKey: testConfig.apiKey,
    apiUrl: testConfig.apiUrl,
    model: testConfig.model,
    narratorVoice: 'en-US-AriaNeural',
    reasoning: testConfig.reasoning ?? undefined,
  });
}

/**
 * Create TextBlockSplitter instance
 */
export function createSplitter(): TextBlockSplitter {
  return new TextBlockSplitter();
}

/**
 * Load fixture text file
 */
export function loadFixtureText(filename: string): string {
  const fixturePath = path.resolve(__dirname, 'fixtures', filename);
  return fs.readFileSync(fixturePath, 'utf-8');
}

/**
 * Run Extract (character extraction)
 */
export async function runExtract(
  service: LLMVoiceService,
  splitter: TextBlockSplitter,
  text: string,
  verbose = true
): Promise<ExtractResult> {
  const blocks = splitter.createExtractBlocks(text);

  if (verbose) {
    console.log(`  Extract: Processing ${blocks.length} block(s)...`);
  }

  const startTime = Date.now();
  const characters = await service.extractCharacters(blocks, (current, total) => {
    if (verbose) {
      console.log(`    Block ${current}/${total}`);
    }
  });
  const durationMs = Date.now() - startTime;

  return {
    characters,
    blockCount: blocks.length,
    durationMs,
  };
}

/**
 * Run Assign (speaker assignment)
 */
export async function runAssign(
  service: LLMVoiceService,
  splitter: TextBlockSplitter,
  text: string,
  characters: LLMCharacter[],
  verbose = true
): Promise<AssignResult> {
  const blocks = splitter.createAssignBlocks(text);

  // Build character voice map
  const characterVoiceMap = new Map<string, string>();
  characters.forEach((char, i) => {
    characterVoiceMap.set(char.canonicalName, `voice-${i}`);
  });

  if (verbose) {
    console.log(`  Assign: Processing ${blocks.length} block(s)...`);
  }

  const startTime = Date.now();
  const assignments = await service.assignSpeakers(
    blocks,
    characterVoiceMap,
    characters,
    (current, total) => {
      if (verbose) {
        console.log(`    Block ${current}/${total}`);
      }
    }
  );
  const durationMs = Date.now() - startTime;

  const dialogueCount = assignments.filter(a => a.speaker !== 'narrator').length;

  return {
    assignments,
    blockCount: blocks.length,
    dialogueCount,
    durationMs,
  };
}

/**
 * Find assignment by text content
 */
export function findAssignment(
  assignments: SpeakerAssignment[],
  textContains: string
): SpeakerAssignment | undefined {
  return assignments.find(a => a.text.includes(textContains));
}

/**
 * Check dialogue line attribution
 * Uses character variations/aliases for matching when characters are provided
 */
export function checkDialogue(
  assignments: SpeakerAssignment[],
  expected: ExpectedDialogue,
  characters?: LLMCharacter[]
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
    // Use alias-aware matching
    matched = speakerMatchesCharacter(assignment.speaker, expected.speaker, characters);
  } else {
    // Fall back to simple string matching
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

/**
 * Log Extract results
 */
export function logExtractResults(result: ExtractResult): void {
  console.log('\n  === Extract Results ===');
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Characters found: ${result.characters.length}`);
  result.characters.forEach(c => {
    console.log(`    - ${c.canonicalName} (${c.gender})`);
    if (c.variations.length > 1) {
      console.log(`      Variations: ${c.variations.join(', ')}`);
    }
  });
}

/**
 * Log Assign results
 */
export function logAssignResults(result: AssignResult): void {
  console.log('\n  === Assign Results ===');
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Total sentences: ${result.assignments.length}`);
  console.log(`  Dialogue sentences: ${result.dialogueCount}`);

  // Group by speaker
  const bySpeaker = new Map<string, number>();
  result.assignments.forEach(a => {
    bySpeaker.set(a.speaker, (bySpeaker.get(a.speaker) || 0) + 1);
  });

  console.log('  By speaker:');
  Array.from(bySpeaker.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([speaker, count]) => {
      console.log(`    - ${speaker}: ${count}`);
    });
}

/**
 * Log dialogue check results
 */
export function logDialogueChecks(results: DialogueCheckResult[]): void {
  console.log('\n  === Dialogue Attribution Checks ===');

  let passed = 0;
  let failed = 0;
  let notFound = 0;

  results.forEach(r => {
    const status = !r.found ? '❓' : r.matched ? '✓' : '✗';
    const marker = r.expected.strict ? '[STRICT]' : '[lenient]';

    if (!r.found) {
      console.log(`  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." - NOT FOUND`);
      notFound++;
    } else if (r.matched) {
      console.log(`  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." → ${r.actualSpeaker} (expected: ${r.expected.speaker})`);
      passed++;
    } else {
      console.log(`  ${status} ${marker} "${r.expected.textContains.substring(0, 30)}..." → ${r.actualSpeaker} (expected: ${r.expected.speaker})`);
      failed++;
    }
  });

  console.log(`\n  Summary: ${passed} passed, ${failed} failed, ${notFound} not found`);
}

/**
 * Get valid speaker set for a fixture
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
