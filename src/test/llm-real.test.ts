import { beforeAll, describe, expect, it } from 'vitest';
import type { LLMVoiceService } from '@/services/llm';
import type { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { findCharacter, fixtures, type TestFixture } from './fixtures';
import {
  type AssignResult,
  checkDialogue,
  createService,
  createSplitter,
  type ExtractResult,
  getValidSpeakers,
  loadFixtureText,
  logAssignResults,
  logDialogueChecks,
  logExtractResults,
  runAssign,
  runExtract,
} from './llm-test-helpers';

/**
 * Real API tests for LLM Extract and Assign (speaker assignment)
 *
 * These tests use actual API calls and are excluded from regular `npm test`.
 * Run with: npm run test:real
 *
 * Before running, populate test.config.local.ts with your API credentials.
 *
 * To add new test cases:
 * 1. Add text file to src/test/fixtures/
 * 2. Add fixture definition in src/test/fixtures/index.ts
 */

describe('LLM Real API Tests', () => {
  let service: LLMVoiceService;
  let splitter: TextBlockSplitter;

  beforeAll(() => {
    service = createService();
    splitter = createSplitter();
  });

  // Run tests for each fixture
  describe.each(fixtures)('Fixture: $name', (fixture: TestFixture) => {
    let text: string;
    let extractResult: ExtractResult;
    let assignResult: AssignResult;

    beforeAll(async () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Testing: ${fixture.name}`);
      console.log(`File: ${fixture.file}`);
      console.log('='.repeat(60));

      // Load fixture text
      text = loadFixtureText(fixture.file);

      // Run Extract
      extractResult = await runExtract(service, splitter, text);
      logExtractResults(extractResult);

      // Run Assign
      assignResult = await runAssign(service, splitter, text, extractResult.characters);
      logAssignResults(assignResult);
    }, 180000); // 3 min timeout for both passes

    describe('Extract - Character Extraction', () => {
      it('should extract expected characters', () => {
        for (const expected of fixture.expectedCharacters) {
          const found = findCharacter(extractResult.characters, expected.name);
          expect(found, `Character "${expected.name}" not found`).toBeDefined();
        }
      });

      it('should detect character genders correctly', () => {
        for (const expected of fixture.expectedCharacters) {
          const found = findCharacter(extractResult.characters, expected.name);
          if (found) {
            expect(found.gender).toBe(expected.gender);
          }
        }
      });

      it('should not have unexpected empty results', () => {
        expect(extractResult.characters.length).toBeGreaterThan(0);
      });
    });

    describe('Assign - Speaker Assignment', () => {
      it('should assign speakers to dialogue', () => {
        expect(assignResult.dialogueCount).toBeGreaterThan(0);
      });

      it('should only use valid speakers', () => {
        const canonicalNames = extractResult.characters.map((c) => c.canonicalName);
        const validSpeakers = getValidSpeakers(canonicalNames);

        for (const assignment of assignResult.assignments) {
          expect(
            validSpeakers.has(assignment.speaker),
            `Invalid speaker: ${assignment.speaker}`,
          ).toBe(true);
        }
      });

      it('should attribute dialogue lines correctly', () => {
        const results = fixture.expectedDialogueLines.map((expected) =>
          checkDialogue(assignResult.assignments, expected, extractResult.characters),
        );

        logDialogueChecks(results);

        // Check strict assertions
        const strictFailures = results.filter((r) => r.expected.strict && !r.matched);
        for (const failure of strictFailures) {
          expect.fail(
            `Strict assertion failed: "${failure.expected.textContains}" ` +
              `expected ${failure.expected.speaker}, got ${failure.actualSpeaker}`,
          );
        }
      });
    });
  });
});
