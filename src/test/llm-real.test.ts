import { describe, it, expect, beforeAll } from 'vitest';
import { fixtures, findCharacter, type TestFixture } from './fixtures';
import {
  createService,
  createSplitter,
  loadFixtureText,
  runPass1,
  runPass2,
  checkDialogue,
  logPass1Results,
  logPass2Results,
  logDialogueChecks,
  getValidSpeakers,
  type Pass1Result,
  type Pass2Result,
} from './llm-test-helpers';
import type { LLMVoiceService } from '@/services/LLMVoiceService';
import type { TextBlockSplitter } from '@/services/TextBlockSplitter';

/**
 * Real API tests for LLM Pass 1 (character extraction) and Pass 2 (speaker assignment)
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
    let pass1Result: Pass1Result;
    let pass2Result: Pass2Result;

    beforeAll(async () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Testing: ${fixture.name}`);
      console.log(`File: ${fixture.file}`);
      console.log('='.repeat(60));

      // Load fixture text
      text = loadFixtureText(fixture.file);

      // Run Pass 1
      pass1Result = await runPass1(service, splitter, text);
      logPass1Results(pass1Result);

      // Run Pass 2
      pass2Result = await runPass2(service, splitter, text, pass1Result.characters);
      logPass2Results(pass2Result);
    }, 180000); // 3 min timeout for both passes

    describe('Pass 1 - Character Extraction', () => {
      it('should extract expected characters', () => {
        for (const expected of fixture.expectedCharacters) {
          const found = findCharacter(pass1Result.characters, expected.name);
          expect(found, `Character "${expected.name}" not found`).toBeDefined();
        }
      });

      it('should detect character genders correctly', () => {
        for (const expected of fixture.expectedCharacters) {
          const found = findCharacter(pass1Result.characters, expected.name);
          if (found) {
            expect(found.gender).toBe(expected.gender);
          }
        }
      });

      it('should not have unexpected empty results', () => {
        expect(pass1Result.characters.length).toBeGreaterThan(0);
      });
    });

    describe('Pass 2 - Speaker Assignment', () => {
      it('should assign speakers to dialogue', () => {
        expect(pass2Result.dialogueCount).toBeGreaterThan(0);
      });

      it('should only use valid speakers', () => {
        const canonicalNames = pass1Result.characters.map(c => c.canonicalName);
        const validSpeakers = getValidSpeakers(canonicalNames);

        for (const assignment of pass2Result.assignments) {
          expect(
            validSpeakers.has(assignment.speaker),
            `Invalid speaker: ${assignment.speaker}`
          ).toBe(true);
        }
      });

      it('should attribute dialogue lines correctly', () => {
        const results = fixture.expectedDialogueLines.map(expected =>
          checkDialogue(pass2Result.assignments, expected)
        );

        logDialogueChecks(results);

        // Check strict assertions
        const strictFailures = results.filter(r => r.expected.strict && !r.matched);
        for (const failure of strictFailures) {
          expect.fail(
            `Strict assertion failed: "${failure.expected.textContains}" ` +
            `expected ${failure.expected.speaker}, got ${failure.actualSpeaker}`
          );
        }
      });
    });
  });
});
