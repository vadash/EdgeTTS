# Assign Phase QA Pass Implementation Plan

**Goal:** Replace the 3-way temperature voting consensus in the Speaker Assignment phase with a sequential Quality Assurance (QA) pass that reviews and corrects draft assignments.

**Architecture:** The new flow will be: `Assign (draft) -> QA (correction)`. When `useVoting` is enabled, the system first generates a draft assignment, then feeds it into a QA prompt that explicitly checks for common LLM mistakes (vocative traps, missed action beats, narration misassignments). This reduces API calls from 3 to 2 while improving accuracy through targeted critique. The existing `useVoting` toggle is kept internally to minimize state migrations, but UI labels are updated to reflect the new "QA Pass" behavior.

**Tech Stack:** TypeScript, Zod 4 (schema validation), OpenAI SDK, existing prompt architecture in `src/config/prompts/`

---

### File Structure Overview

- **Create:** `src/config/prompts/qa/role.ts` - QA prompt role definition
- **Create:** `src/config/prompts/qa/rules.ts` - QA-specific rules for error detection
- **Create:** `src/config/prompts/qa/builder.ts` - QA prompt message builder
- **Create:** `src/config/prompts/qa/schema.ts` - Reuse ASSIGN_SCHEMA_TEXT (same output format)
- **Create:** `src/config/prompts/qa/examples/en.ts` - Few-shot examples showing flawed drafts being corrected
- **Create:** `src/config/prompts/qa/examples/index.ts` - Example loader for QA stage
- **Create:** `src/services/llm/assignWithQA.test.ts` - Integration tests for the QA flow
- **Modify:** `src/config/prompts/index.ts` - Export `buildQAPrompt` from new QA module
- **Modify:** `src/services/llm/LLMVoiceService.ts` - Refactor `processAssignBlock` to implement Assign -> QA flow
- **Modify:** `src/services/llm/votingConsensus.ts` - Remove `majorityVote` function (no longer used)
- **Modify:** `src/components/settings/tabs/StageConfigForm.tsx` - Update voting toggle labels
- **Modify:** `src/i18n/en.json` - Update `useVoting` label from "3-Way Voting" to "Enable QA Pass"
- **Modify:** `src/i18n/ru.json` - Update Russian translation for `useVoting`

---

### Task 1: Create QA Prompt Directory Structure

**Purpose:** Scaffold the new QA prompt module following the existing pattern (extract/merge/assign).

**Files:**
- Create: `src/config/prompts/qa/role.ts`
- Create: `src/config/prompts/qa/rules.ts`
- Create: `src/config/prompts/qa/schema.ts`
- Create: `src/config/prompts/qa/builder.ts`
- Create: `src/config/prompts/qa/examples/en.ts`
- Create: `src/config/prompts/qa/examples/index.ts`

**Common Pitfalls:**
- QA uses the same output schema as Assign - reuse `ASSIGN_SCHEMA_TEXT`, don't duplicate
- Examples must show flawed drafts being corrected, not perfect assignments
- The builder must inject draft assignments as a separate XML block

- [ ] Step 1: Create the QA role definition

**File:** `src/config/prompts/qa/role.ts`

```typescript
// src/config/prompts/qa/role.ts
// Quality Assurance stage: Review and correct draft speaker assignments

export const QA_ROLE = `You are an expert dialogue editor and quality assurance bot.
Your job is to review a draft speaker attribution for a text, find mistakes, and output the corrected mapping.

1. Read the provided list of "Speaker Codes".
2. Read the "Numbered Paragraphs" (the original text).
3. Read the "Draft Assignments" (the potentially flawed initial assignments).
4. Identify errors in the draft: vocative traps, missed action beats, misassigned narration, missing dialogue.
5. Output a corrected JSON mapping paragraph numbers to Speaker Codes.`;
```

- [ ] Step 2: Create the QA rules

**File:** `src/config/prompts/qa/rules.ts`

```typescript
// src/config/prompts/qa/rules.ts
// Quality Assurance rules for correcting draft assignments

export const QA_RULES = `1. REVIEW THE DRAFT:
   Check every assignment in the draft against the original text. Look for these common LLM errors:

2. VOCATIVE TRAP:
   Did the draft assign the quote to the person being spoken TO?
   Example: "John, run!" assigned to John is WRONG. John is the listener, not the speaker.
   Fix: Reassign to the actual speaker (the other character in the scene).

3. MISSED ACTION BEATS:
   Did the draft miss an action beat indicating a different speaker?
   Example: "Hello." Mary smiled. "Welcome." — The draft might assign both quotes to Mary, but the first "Hello" is from someone else.
   Fix: Check the text before/after quotes for action beats that reveal speakers.

4. MISASSIGNED NARRATION:
   Did the draft assign a speaker code to a purely narrational paragraph?
   Example: Paragraph describing the sunset has a speaker code.
   Fix: Remove the assignment. Pure narration has no speaker.

5. MISSING DIALOGUE:
   Did the draft miss a paragraph containing dialogue entirely?
   Example: A quote exists but no assignment in the draft.
   Fix: Add the correct speaker code for that paragraph.

6. NEGATIVE INDICES ARE READ-ONLY:
   Paragraphs labeled with negative indices inside the previous context block are from the previous section for context only. Do NOT assign speaker codes to them.

7. OUTPUT FORMAT:
   Use the same JSON format as the draft: { "reasoning": "...", "assignments": { "0": "A", "1": "B" } }
   The reasoning field should briefly note what errors were found and corrected.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the corrected assignments.
CRITICAL: Keep reasoning concise. Focus only on errors found and corrections made.`;
```

- [ ] Step 3: Create the QA schema (reuses Assign schema)

**File:** `src/config/prompts/qa/schema.ts`

```typescript
// src/config/prompts/qa/schema.ts
// QA uses the same output schema as Assign

import { ASSIGN_SCHEMA_TEXT } from '../assign/schema';

export { ASSIGN_SCHEMA_TEXT as QA_SCHEMA_TEXT };
```

- [ ] Step 4: Create the QA prompt builder

**File:** `src/config/prompts/qa/builder.ts`

```typescript
// src/config/prompts/qa/builder.ts
// Builds the QA prompt that reviews draft assignments

import type { LLMCharacter } from '@/state/types';
import {
  assembleSystemPrompt,
  assembleUserConstraints,
  buildMessages,
  formatExamples,
} from '../shared/formatters';
import { getQAExamples } from './examples';
import { QA_ROLE } from './role';
import { QA_RULES } from './rules';
import { QA_SCHEMA_TEXT } from './schema';

export interface QAContext {
  characters: LLMCharacter[];
  nameToCode: Map<string, string>;
  numberedParagraphs: string;
  draftAssignments: Record<string, string>;
  overlapSentences?: string[];
}

export function buildQAPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  draftAssignments: Record<string, string>,
  detectedLanguage: string = 'en',
  overlapSentences?: string[],
) {
  const examples = getQAExamples();

  const characterLines = characters.map((char) => {
    const code = nameToCode.get(char.canonicalName)!;
    const aliases = char.variations.filter((v) => v !== char.canonicalName);
    const genderInfo = char.gender !== 'unknown' ? ` [${char.gender}]` : '';
    if (aliases.length > 0) {
      return `- ${code} = ${char.canonicalName}${genderInfo} (aliases: ${aliases.join(', ')})`;
    }
    return `- ${code} = ${char.canonicalName}${genderInfo}`;
  });

  const unnamedEntries = Array.from(nameToCode.entries())
    .filter(([name]) => name.includes('UNNAMED'))
    .map(([name, code]) => `- ${code} = ${name}`);

  const characterLinesStr = characterLines.join('\n');
  const unnamedEntriesStr = unnamedEntries.join('\n');

  let previousContext = '';
  if (overlapSentences && overlapSentences.length > 0) {
    const count = overlapSentences.length;
    const lines = overlapSentences.map((text, i) => `[${i - count}] ${text}`);
    previousContext = `<previous_context_do_not_assign>\n${lines.join('\n')}\n</previous_context_do_not_assign>`;
  }

  const draftJson = JSON.stringify(draftAssignments, null, 2);

  const sys = assembleSystemPrompt(QA_ROLE, formatExamples(examples));
  const constraints = assembleUserConstraints(QA_RULES, QA_SCHEMA_TEXT);
  const user = `<speaker_codes>
${characterLinesStr}
${unnamedEntriesStr}
</speaker_codes>

${previousContext}

<numbered_paragraphs>
${numberedParagraphs}
</numbered_paragraphs>

<draft_assignments>
${draftJson}
</draft_assignments>

[FINAL INSTRUCTION]:
Review the draft assignments above and correct any errors.
Output the corrected JSON now.`;

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
```

- [ ] Step 5: Create QA examples showing flawed drafts

**File:** `src/config/prompts/qa/examples/en.ts`

```typescript
// src/config/prompts/qa/examples/en.ts
// QA examples showing flawed drafts being corrected

import type { PromptExample } from '../../shared/formatters';

export const qaExamplesEN: PromptExample[] = [
  {
    label: '(EN/VocativeTrapCorrection)',
    input: `[Speaker Codes]:
- A = John [male]
- B = Guard [unknown]

[Numbered Paragraphs]:
[0] "Halt!" the guard shouted.
[1] "What is it?" John asked.
[2] "Show your papers, John," the guard ordered.

[Draft Assignments]:
{
  "reasoning": "0 is Guard. 1 is John asking. 2 is John showing papers.",
  "assignments": {
    "0": "B",
    "1": "A",
    "2": "A"
  }
}`,
    output: `{
  "reasoning": "Found vocative trap in [2]: 'John' inside quotes is the listener, not speaker. Reassigned to Guard (B).",
  "assignments": {
    "0": "B",
    "1": "A",
    "2": "B"
  }
}`,
  },
  {
    label: '(EN/MissedActionBeat)',
    input: `[Speaker Codes]:
- A = Mary [female]
- B = Protagonist [unknown]

[Numbered Paragraphs]:
[0] "Hello there." Mary smiled.
[1] "Welcome to the shop."

[Draft Assignments]:
{
  "reasoning": "Both quotes are from Mary.",
  "assignments": {
    "0": "A",
    "1": "A"
  }
}`,
    output: `{
  "reasoning": "Fixed missed action beat: [0] has 'Mary smiled' action beat, but 'Hello there' is spoken by someone else before Mary smiled. Context suggests Protagonist spoke first.",
  "assignments": {
    "0": "B",
    "1": "A"
  }
}`,
  },
  {
    label: '(EN/RemovedNarrationAndAddedMissing)',
    input: `[Speaker Codes]:
- A = Kira [female]
- B = System [female]

[Numbered Paragraphs]:
[0] The dungeon door creaked open.
[1] [Dungeon Entered: Shadow Crypt]
[2] "Finally," Kira whispered.
[3] A skeleton charged toward her.

[Draft Assignments]:
{
  "reasoning": "0 is narration, 1 is System, 2 is Kira, 3 is narration",
  "assignments": {
    "0": "A",
    "1": "B",
    "2": "A"
  }
}`,
    output: `{
  "reasoning": "Removed misassigned narration from [0] (door description has no speaker). [3] is also narration, correctly omitted.",
  "assignments": {
    "1": "B",
    "2": "A"
  }
}`,
  },
];
```

- [ ] Step 6: Create QA examples index

**File:** `src/config/prompts/qa/examples/index.ts`

```typescript
// src/config/prompts/qa/examples/index.ts

import type { PromptExample } from '../../shared/formatters';
import { qaExamplesEN } from './en';

export function getQAExamples(language: string = 'en'): PromptExample[] {
  // Currently only English examples exist
  return qaExamplesEN;
}
```

- [ ] Step 7: Run TypeScript check

Run: `npx tsc --noEmit src/config/prompts/qa/*.ts src/config/prompts/qa/**/*.ts`
Expected: No errors

- [ ] Step 8: Commit

```bash
git add -A && git commit -m "feat: scaffold QA prompt module for Assign phase"
```

---

### Task 2: Export QA Builder from Prompts Index

**Purpose:** Make `buildQAPrompt` available for import in LLMVoiceService.

**Files:**
- Modify: `src/config/prompts/index.ts`

- [ ] Step 1: Add export for buildQAPrompt

**File:** `src/config/prompts/index.ts`

Add after line 6:

```typescript
export { buildQAPrompt } from './qa/builder';
```

The file should now read:

```typescript
// src/config/prompts/index.ts
// LLM Prompts Configuration -- OpenVault-style architecture
// Pipeline: Extract -> Merge -> Assign

export { buildAssignPrompt } from './assign/builder';
export { buildExtractPrompt } from './extract/builder';
export { buildMergePrompt } from './merge/builder';
export { buildQAPrompt } from './qa/builder';
export { formatExamples, type PromptExample } from './shared/formatters';
export {
  DEFAULT_PREFILL,
  PREFILL_PRESETS,
  type PrefillPreset,
  SYSTEM_PREAMBLE_CN,
} from './shared/preambles';
export { EXECUTION_TRIGGER, MIRROR_LANGUAGE_RULES } from './shared/rules';
```

- [ ] Step 2: Run TypeScript check

Run: `npx tsc --noEmit src/config/prompts/index.ts`
Expected: No errors

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat: export buildQAPrompt from prompts index"
```

---

### Task 3: Refactor LLMVoiceService for Assign -> QA Flow

**Purpose:** Replace 3-way voting with sequential Assign -> QA flow in `processAssignBlock`.

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`

**Common Pitfalls:**
- Remove `VOTING_TEMPERATURES` constant (no longer needed)
- Keep the retry logic for both Assign and QA calls
- Save debug logs for both passes (`assign_draft` and `assign_qa`)
- The QA call uses the same temperature/settings as the initial Assign call
- Ensure proper error handling - if QA fails, fall back to draft results

- [ ] Step 1: Write failing test for new QA flow

**File:** Create test first (we'll add this to existing assign.test.ts or create new)

For now, skip this step since we'll verify with existing tests after implementation.

- [ ] Step 2: Remove VOTING_TEMPERATURES and refactor processAssignBlock

**File:** `src/services/llm/LLMVoiceService.ts`

Replace lines 85-87 (VOTING_TEMPERATURES constant):

```typescript
// REMOVE THESE LINES:
/**
 * Voting temperatures for 3-way voting (assign step)
 */
const VOTING_TEMPERATURES = [0.1, 0.4, 0.7] as const;
```

Update imports at line 18 to include buildQAPrompt:

```typescript
// Change from:
import {
  type AssignContext,
  buildAssignPrompt,
  buildExtractPrompt,
  buildMergePrompt,
} from './PromptStrategy';

// To:
import {
  type AssignContext,
  buildAssignPrompt,
  buildExtractPrompt,
  buildMergePrompt,
} from './PromptStrategy';
import { buildQAPrompt } from '@/config/prompts/qa/builder';
```

Replace the entire `processAssignBlock` method (lines 349-477 approximately). The new implementation:

```typescript
  /**
   * Process a single block for Assign using structured outputs
   * New format: sparse JSON object {"0": "A", "5": "B"}
   * When useVoting is enabled: runs Assign -> QA sequential flow
   */
  private async processAssignBlock(
    block: TextBlock,
    characterVoiceMap: Map<string, string>,
    characters: LLMCharacter[],
    nameToCode: Map<string, string>,
    codeToName: Map<string, string>,
    overlapSentences?: string[],
  ): Promise<SpeakerAssignment[]> {
    this.logger?.debug(
      `[processAssignBlock] Block starting at ${block.sentenceStartIndex}, ${block.sentences.length} sentences`,
    );

    // Use 0-based indexing for LLM
    const numberedParagraphs = block.sentences.map((s, i) => `[${i}] ${s}`).join('\n');

    // Build context
    const context: AssignContext = {
      characters,
      nameToCode,
      codeToName,
      numberedParagraphs,
      sentenceCount: block.sentences.length,
    };

    const assignMessages = buildAssignPrompt(
      context.characters,
      context.nameToCode,
      context.numberedParagraphs,
      this.detectedLanguage,
      overlapSentences,
    );

    let relativeMap: Map<number, string>;

    try {
      // Step 1: Always run the initial Assign call
      const draftResponse = await withRetry(
        () =>
          this.apiClient.callStructured({
            messages: assignMessages,
            schema: AssignSchema,
            schemaName: 'AssignSchema',
            signal: this.abortController?.signal,
          }),
        {
          maxRetries: RETRY_CONFIG.assign,
          signal: this.abortController?.signal,
          onRetry: (attempt, error) => {
            this.logger?.warn(
              `[assign] Block at ${block.sentenceStartIndex} retry ${attempt}/${RETRY_CONFIG.assign}: ${getErrorMessage(error)}`,
            );
          },
        },
      );

      // Convert draft response to Map
      const draftMap = new Map<number, string>();
      for (const [key, code] of Object.entries(draftResponse.assignments)) {
        const index = parseInt(key, 10);
        if (context.codeToName.has(code)) {
          draftMap.set(index, code);
        }
      }

      // Save first assign phase log (draft)
      if (this.isFirstAssignBlock) {
        await this.apiClient.debugLogger?.savePhaseLog(
          'assign_draft',
          { messages: assignMessages },
          draftResponse,
        );
      }

      // Step 2: If useVoting is enabled, run QA pass
      if (this.options.useVoting) {
        const qaMessages = buildQAPrompt(
          context.characters,
          context.nameToCode,
          context.numberedParagraphs,
          draftResponse.assignments,
          this.detectedLanguage,
          overlapSentences,
        );

        try {
          const qaResponse = await withRetry(
            () =>
              this.apiClient.callStructured({
                messages: qaMessages,
                schema: AssignSchema,
                schemaName: 'AssignSchema',
                signal: this.abortController?.signal,
              }),
            {
              maxRetries: RETRY_CONFIG.assign,
              signal: this.abortController?.signal,
              onRetry: (attempt, error) => {
                this.logger?.warn(
                  `[assign] QA pass at ${block.sentenceStartIndex} retry ${attempt}/${RETRY_CONFIG.assign}: ${getErrorMessage(error)}`,
                );
              },
            },
          );

          // Convert QA response to Map
          relativeMap = new Map<number, string>();
          for (const [key, code] of Object.entries(qaResponse.assignments)) {
            const index = parseInt(key, 10);
            if (context.codeToName.has(code)) {
              relativeMap.set(index, code);
            }
          }

          // Save QA phase log
          if (this.isFirstAssignBlock) {
            await this.apiClient.debugLogger?.savePhaseLog(
              'assign_qa',
              { messages: qaMessages },
              qaResponse,
            );
            this.isFirstAssignBlock = false;
          }

          this.logger?.info(
            `[assign] Block at ${block.sentenceStartIndex} completed with QA correction`,
          );
        } catch (qaError) {
          // QA failed - fall back to draft results
          this.logger?.warn(
            `[assign] QA pass failed at ${block.sentenceStartIndex}, using draft: ${getErrorMessage(qaError)}`,
          );
          relativeMap = draftMap;

          if (this.isFirstAssignBlock) {
            this.isFirstAssignBlock = false;
          }
        }
      } else {
        // No QA pass - use draft directly
        relativeMap = draftMap;

        if (this.isFirstAssignBlock) {
          this.isFirstAssignBlock = false;
        }
      }
    } catch (_e) {
      this.logger?.warn(
        `[assign] Block at ${block.sentenceStartIndex} failed after ${RETRY_CONFIG.assign} retries, using default voice for ${block.sentences.length} sentences`,
      );
      return block.sentences.map((text, i) => ({
        sentenceIndex: block.sentenceStartIndex + i,
        text,
        speaker: 'narrator',
        voiceId: this.options.narratorVoice,
      }));
    }

    return block.sentences.map((text, i) => {
      const absoluteIndex = block.sentenceStartIndex + i;
      const relativeIndex = i;
      const speakerCode = relativeMap.get(relativeIndex);
      const speaker = speakerCode ? (codeToName.get(speakerCode) ?? 'narrator') : 'narrator';
      return {
        sentenceIndex: absoluteIndex,
        text,
        speaker,
        voiceId:
          speaker === 'narrator'
            ? this.options.narratorVoice
            : (characterVoiceMap.get(speaker) ?? this.options.narratorVoice),
      };
    });
  }
```

- [ ] Step 3: Remove import for majorityVote (no longer used in this file)

Update line 21:

```typescript
// Change from:
import { buildMergeConsensus, majorityVote } from './votingConsensus';

// To:
import { buildMergeConsensus } from './votingConsensus';
```

- [ ] Step 4: Run tests to verify the refactor

Run: `npm test -- src/services/llm/assign.test.ts --reporter=verbose`
Expected: Tests pass (they use mocked responses, not actual voting)

- [ ] Step 5: Run full test suite

Run: `npm test`
Expected: All tests pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat: replace 3-way voting with Assign->QA sequential flow"
```

---

### Task 4: Remove majorityVote from votingConsensus.ts

**Purpose:** Clean up unused code. The `majorityVote` function is no longer used.

**Files:**
- Modify: `src/services/llm/votingConsensus.ts`

**Common Pitfalls:**
- Keep `buildMergeConsensus` - it's still used by the Merge phase
- Update the test file to remove tests for `majorityVote`

- [ ] Step 1: Remove majorityVote function

**File:** `src/services/llm/votingConsensus.ts`

Replace the entire file content:

```typescript
import type { Logger } from '../Logger';

/**
 * Build consensus merge groups from multiple votes using Union-Find.
 * Pairs appearing in >=2 of 5 votes get merged.
 * Returns 0-based index groups.
 */
export function buildMergeConsensus(votes: number[][][], logger?: Logger): number[][] {
  // Count how many votes have each pair in same group
  const pairCounts = new Map<string, number>();
  // Track which index was "keep" (first in group) for each pair
  const keepVotes = new Map<string, number[]>();

  for (const vote of votes) {
    for (const group of vote) {
      if (group.length < 2) continue;
      const keep = group[0];
      const sorted = [...group].sort((a, b) => a - b);

      // Count all pairs in this group
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]},${sorted[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          // Track who was keep for this pair
          if (!keepVotes.has(key)) keepVotes.set(key, []);
          keepVotes.get(key)!.push(keep);
        }
      }
    }
  }

  // Build edges from pairs with >=2 votes (2 out of 5 is enough)
  const edges: [number, number][] = [];
  let pairsWithConsensus = 0;
  for (const [key, count] of pairCounts) {
    if (count >= 2) {
      const [a, b] = key.split(',').map(Number);
      edges.push([a, b]);
      pairsWithConsensus++;
    }
  }

  logger?.info(
    `[Merge] Consensus: ${pairCounts.size} unique pairs, ${pairsWithConsensus} with >=2 votes`,
  );

  // Union-Find to build connected components
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (x: number, y: number) => {
    const px = find(x),
      py = find(y);
    if (px !== py) parent.set(px, py);
  };

  for (const [a, b] of edges) {
    union(a, b);
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(node);
  }

  // For each group, pick "keep" as the most-voted keep index, or smallest
  const result: number[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue; // Skip singletons

    // Count keep votes for members of this group
    const keepCounts = new Map<number, number>();
    const sorted = [...members].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]},${sorted[j]}`;
        const keeps = keepVotes.get(key) ?? [];
        for (const k of keeps) {
          if (members.includes(k)) {
            keepCounts.set(k, (keepCounts.get(k) ?? 0) + 1);
          }
        }
      }
    }

    // Pick most-voted keep, or smallest index
    let keepIdx = Math.min(...members);
    let maxVotes = 0;
    for (const [idx, count] of keepCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        keepIdx = idx;
      }
    }

    // Build group with keep first
    result.push([keepIdx, ...members.filter((m) => m !== keepIdx)]);
  }

  return result;
}
```

- [ ] Step 2: Update votingConsensus.test.ts to remove majorityVote tests

**File:** `src/services/llm/votingConsensus.test.ts`

Replace the entire file content to only test `buildMergeConsensus`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildMergeConsensus } from './votingConsensus';

describe('buildMergeConsensus', () => {
  it('builds consensus from multiple merge votes', () => {
    // Simulate 3 votes that agree on merging indices 0 and 1
    const votes: number[][][] = [
      [[0, 1], [2]], // Vote 1: merge 0,1
      [[0, 1], [2]], // Vote 2: merge 0,1
      [[0, 1], [2]], // Vote 3: merge 0,1
    ];

    const result = buildMergeConsensus(votes);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain(0);
    expect(result[0]).toContain(1);
  });

  it('requires at least 2 votes for consensus', () => {
    // Only 1 vote for merging, should not merge
    const votes: number[][][] = [
      [[0, 1], [2]],
      [[0], [1], [2]],
      [[0], [1], [2]],
    ];

    const result = buildMergeConsensus(votes);

    expect(result).toHaveLength(0);
  });

  it('handles empty votes', () => {
    const result = buildMergeConsensus([]);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] Step 3: Run tests

Run: `npm test -- src/services/llm/votingConsensus.test.ts --reporter=verbose`
Expected: Tests pass

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "refactor: remove majorityVote function (no longer used)"
```

---

### Task 5: Update UI Labels from "3-Way Voting" to "QA Pass"

**Purpose:** Update the UI to reflect the new QA Pass behavior instead of 3-way voting.

**Files:**
- Modify: `src/components/settings/tabs/StageConfigForm.tsx`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ru.json`

- [ ] Step 1: Update StageConfigForm.tsx toggle label and title

**File:** `src/components/settings/tabs/StageConfigForm.tsx`

Replace lines 149-155 (the Voting toggle):

```tsx
        {/* Voting - only for Assign stage */}
        {showVoting && onVotingChange && (
          <Toggle
            checked={useVoting ?? false}
            onChange={onVotingChange}
            label="Enable QA Pass"
            title="Runs a second QA pass to review and correct speaker assignments (2x API cost)"
            disabled={isReasoningEnabled}
          />
        )}
```

- [ ] Step 2: Add i18n keys for QA Pass in en.json

**File:** `src/i18n/en.json`

Add these keys under the `"llm"` section (after line 58, before `promptRepetition`):

```json
    "useVoting": "Enable QA Pass",
    "useVotingDesc": "Review and correct speaker assignments with a second LLM pass",
    "useVotingHint": "Runs a QA pass to catch vocative traps, missed action beats, and narration errors (2x API cost)",
```

Also update the existing voting-related text if any. Since the toggle was hardcoded, we're adding i18n support now.

- [ ] Step 3: Add i18n keys for QA Pass in ru.json

**File:** `src/i18n/ru.json`

Add these keys under the `"llm"` section:

```json
    "useVoting": "Включить QA проверку",
    "useVotingDesc": "Проверка и исправление назначений говорящих вторым проходом LLM",
    "useVotingHint": "Запускает QA проход для поиска ошибок: обращения к слушателю, пропущенные действия, ошибочная речь у narrator (2x стоимость API)",
```

- [ ] Step 4: Update StageConfigForm to use i18n

**File:** `src/components/settings/tabs/StageConfigForm.tsx`

Update the Toggle to use i18n:

```tsx
        {/* Voting - only for Assign stage */}
        {showVoting && onVotingChange && (
          <Toggle
            checked={useVoting ?? false}
            onChange={onVotingChange}
            label={<Text id="llm.useVoting" />}
            title="llm.useVotingHint"
            disabled={isReasoningEnabled}
          />
        )}
```

Wait, the Toggle component might not support React nodes for label. Let's check the Toggle component first or use a simpler approach. For now, keep it simple and hardcoded with the new text.

Actually, let's keep it simpler - just update the hardcoded text and add i18n keys for future use:

```tsx
        {/* QA Pass - only for Assign stage */}
        {showVoting && onVotingChange && (
          <Toggle
            checked={useVoting ?? false}
            onChange={onVotingChange}
            label="Enable QA Pass"
            title="Runs a QA pass to catch vocative traps, missed action beats, and narration errors (2x API cost)"
            disabled={isReasoningEnabled}
          />
        )}
```

- [ ] Step 5: Run TypeScript check

Run: `npx tsc --noEmit src/components/settings/tabs/StageConfigForm.tsx`
Expected: No errors

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat: update UI labels from 3-way voting to QA Pass"
```

---

### Task 6: Create Integration Tests for QA Flow

**Purpose:** Ensure the Assign -> QA flow works correctly with mocked responses.

**Files:**
- Create: `src/services/llm/assignWithQA.test.ts`

- [ ] Step 1: Create integration test for QA flow

**File:** `src/services/llm/assignWithQA.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMCharacter, TextBlock } from '@/state/types';
import { LLMVoiceService } from './LLMVoiceService';

// Mock OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('LLMVoiceService - Assign with QA Pass', () => {
  let service: LLMVoiceService;
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
    { canonicalName: 'Bob', variations: ['Bob'], gender: 'male' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs QA pass when useVoting is enabled and corrects assignments', async () => {
    // First call (draft) - contains a vocative trap error
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Assigning speakers',
              assignments: {
                '0': 'A', // Alice says "Hello Bob" - WRONG, this is vocative trap
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    // Second call (QA) - corrects the error
    const qaResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Fixed vocative trap: Bob is listener in [0]',
              assignments: {
                '0': 'B', // Corrected: Bob is speaking TO Alice
                '1': 'A', // Alice responds
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    // Setup mock to return different responses for each call
    const openai = await import('openai');
    let callCount = 0;
    const mockCreate = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? draftResponse : qaResponse);
    });
    vi.mocked(openai.default).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as any,
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: true, // Enable QA pass
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello Bob," said Alice.', '"Hi Alice," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made 2 API calls (draft + QA)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Result should use QA-corrected assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Bob'); // Corrected by QA
    expect(result[1].speaker).toBe('Alice');
  });

  it('falls back to draft when QA pass fails', async () => {
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Draft assignments',
              assignments: {
                '0': 'A',
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    const openai = await import('openai');
    let callCount = 0;
    const mockCreate = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(draftResponse);
      }
      throw new Error('QA pass failed');
    });
    vi.mocked(openai.default).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as any,
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: true,
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have tried 2 calls (draft succeeded, QA failed)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Result should use draft assignments
    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });

  it('skips QA pass when useVoting is disabled', async () => {
    const draftResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              reasoning: 'Direct assignment',
              assignments: {
                '0': 'A',
                '1': 'B',
              },
            }),
            refusal: null,
          },
        },
      ],
      model: 'gpt-4o-mini',
    };

    const openai = await import('openai');
    const mockCreate = vi.fn().mockResolvedValue(draftResponse);
    vi.mocked(openai.default).mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as any,
    );

    service = new LLMVoiceService({
      apiKey: 'test-key',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      narratorVoice: 'narrator-voice',
      useVoting: false, // Disabled
      logger: mockLogger,
    });

    const blocks: TextBlock[] = [
      {
        sentenceStartIndex: 0,
        sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      },
    ];

    const result = await service.assignSpeakers(blocks, new Map(), characters);

    // Should have made only 1 API call
    expect(mockCreate).toHaveBeenCalledTimes(1);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe('Alice');
    expect(result[1].speaker).toBe('Bob');
  });
});
```

- [ ] Step 2: Run the new tests

Run: `npm test -- src/services/llm/assignWithQA.test.ts --reporter=verbose`
Expected: All 3 tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test: add integration tests for Assign->QA flow"
```

---

### Task 7: Run Full Test Suite and Verify

**Purpose:** Ensure all changes work together and don't break existing functionality.

- [ ] Step 1: Run full test suite

Run: `npm test`
Expected: All tests pass

- [ ] Step 2: Run TypeScript check on all modified files

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] Step 3: Build the project

Run: `npm run build`
Expected: Build succeeds

- [ ] Step 4: Final commit

```bash
git add -A && git commit -m "feat: complete Assign phase QA Pass implementation"
```

---

## Summary

This plan implements the Assign Phase QA Pass feature:

1. **Created QA Prompt Module** (`src/config/prompts/qa/*`) - New prompt directory with role, rules, builder, and examples specifically designed to catch LLM assignment errors.

2. **Refactored LLMVoiceService** - Replaced 3-way temperature voting with a sequential `Assign -> QA` flow:
   - First call generates draft assignments
   - Second call (when enabled) reviews and corrects the draft
   - Falls back to draft if QA fails
   - Reduces API calls from 3 to 2

3. **Removed Unused Code** - Cleaned up `majorityVote` function from `votingConsensus.ts`.

4. **Updated UI Labels** - Changed "3-Way Voting" to "Enable QA Pass" with descriptive tooltip.

5. **Added Tests** - Integration tests verify the new flow works correctly.

**Key Benefits:**
- Lower API cost (2 calls instead of 3)
- Better accuracy through targeted error detection (vocative traps, action beats, narration)
- Sequential flow avoids rate limiting issues from parallel calls
- Maintains backward compatibility with existing `useVoting` state
