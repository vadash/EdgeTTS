# Fix LLM Pipeline Errors Implementation Plan

**Goal:** Fix the fundamental conflict between Structured Outputs and XML prefilling, reduce cognitive overload in Assign phase, and improve text scrubbing for tool call hallucinations.

**Architecture:** The LLM pipeline uses a 3-message topology (System → User → Assistant prefill). Currently the prefill uses `<thinking>` tags which conflict with OpenAI's `strict: true` JSON schema enforcement. The fix moves reasoning into the JSON "reasoning" field, reduces block sizes for Assign phase, and adds aggressive text scrubbing.

**Tech Stack:** TypeScript, Zod 4, OpenAI SDK, Vitest for testing.

---

## File Structure Overview

- **Modify:** `src/config/prompts/shared/preambles.ts` - Change default prefill from 'auto' to 'none'
- **Modify:** `src/config/prompts/extract/rules.ts` - Update thinking instructions to use JSON reasoning field
- **Modify:** `src/config/prompts/assign/rules.ts` - Update thinking instructions to use JSON reasoning field
- **Modify:** `src/config/index.ts` - Reduce `assignBlockTokens` from 8000 to 3000
- **Modify:** `src/utils/text.ts` - Add aggressive `<tool_call>` regex scrubbing
- **Modify:** `src/services/llm/PromptStrategy.ts` - Add fallback for unknown speaker codes to UNKNOWN_UNNAMED
- **Modify:** `src/services/llm/LLMApiClient.ts` - Safer header handling in custom fetch
- **Modify:** `src/config/prompts/extract/rules.ts` - Add rule for extracting secondary/mentor characters
- **Create:** `src/utils/__tests__/text.toolcall.test.ts` - Test tool call hallucination scrubbing
- **Create:** `src/services/llm/__tests__/PromptStrategy.fallback.test.ts` - Test unknown code fallback

---

### Task 1: Update Default Prefill Configuration

**Files:**
- Modify: `src/config/prompts/shared/preambles.ts`
- Test: `src/config/prompts/__tests__/preambles.test.ts`

**Common Pitfalls:**
- The `DEFAULT_PREFILL` constant is used by `formatters.ts` to select the assistant prefill
- Changing to 'none' removes the `<thinking>` prefill entirely, letting the model use the JSON reasoning field

- [ ] Step 1: Write the failing test

```typescript
// src/config/prompts/__tests__/preambles.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFILL, PREFILL_PRESETS } from '../shared/preambles';

describe('DEFAULT_PREFILL', () => {
  it('should be set to "none" to avoid XML/JSON conflicts', () => {
    expect(DEFAULT_PREFILL).toBe('none');
  });

  it('should have "none" preset that returns empty string', () => {
    expect(PREFILL_PRESETS.none).toBe('');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/config/prompts/__tests__/preambles.test.ts -v`
Expected: FAIL with "expected 'auto' to be 'none'"

- [ ] Step 3: Write minimal implementation

```typescript
// src/config/prompts/shared/preambles.ts
// Change line 44:
export const DEFAULT_PREFILL: PrefillPreset = 'none';
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/config/prompts/__tests__/preambles.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: change DEFAULT_PREFILL to 'none' to resolve XML/JSON conflict"
```

---

### Task 2: Update Extract Rules Thinking Instructions

**Files:**
- Modify: `src/config/prompts/extract/rules.ts`
- Test: `src/config/prompts/__tests__/extract.rules.test.ts`

**Common Pitfalls:**
- The `<thinking_process>` section is wrapped in backticks and injected into prompts
- Must preserve all 6 steps, just change WHERE reasoning is written

- [ ] Step 1: Write the failing test

```typescript
// src/config/prompts/__tests__/extract.rules.test.ts
import { describe, it, expect } from 'vitest';
import { EXTRACT_RULES } from '../extract/rules';

describe('EXTRACT_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(EXTRACT_RULES).toContain('Write your step-by-step work inside the JSON "reasoning" field');
    expect(EXTRACT_RULES).not.toContain('<thinking_process>');
    expect(EXTRACT_RULES).not.toContain('</thinking_process>');
    expect(EXTRACT_RULES).not.toContain('Write your work inside <thinking> tags');
  });

  it('should include aggressive character extraction rule', () => {
    expect(EXTRACT_RULES).toContain('Extract EVERY named character who speaks');
    expect(EXTRACT_RULES).toContain('mentors, shopkeepers, or background characters');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/config/prompts/__tests__/extract.rules.test.ts -v`
Expected: FAIL with "expected string to contain 'Write your step-by-step work inside the JSON'"

- [ ] Step 3: Write minimal implementation

```typescript
// src/config/prompts/extract/rules.ts
// Replace the entire file content:

// src/config/prompts/extract/rules.ts
// Pipeline stage 1 of 3: Extract → Merge → Assign

export const EXTRACT_RULES = `1. HOW TO FIND SPEECH:
   - Look for quotes: "Hello", 'Hi', «Привет», „Hallo"
   - Look for game system messages in brackets: [Level Up!], [Quest]
   - Look for telepathy in angle brackets: <Can you hear me?>
   - Look for thoughts in asterisks: *I must run*

2. HOW TO FIND THE SPEAKER:
   - Look for speech verbs near the quotes: said, asked, shouted, replied. Example: "Hi," John said. -> Speaker is John.
   - Look for actions near the quotes. Example: Sarah nodded. "Yes." -> Speaker is Sarah.
   - First-person narrator: If the text says "I said" or "I asked", the speaker is "Protagonist".
   - System messages: If the text is [Level Up!], the speaker is "System".

3. WHO NOT TO EXTRACT (CRITICAL):
   - Do NOT extract a character if they are only mentioned by someone else.
   - Do NOT extract a character if their name is inside the quotes (Vocative).
     Example: "John, come here!" said Mary. -> Mary is the speaker. John is just listening. Do NOT extract John based on this sentence.
   - Do NOT extract sound effects like [Bang!] or [Sigh].

4. HOW TO FORMAT NAMES AND GENDER:
   - "canonicalName": The best, most complete name you can find (e.g., "Queen Elizabeth", "John Smith", "System", "Protagonist").
   - "variations": An array of ALL names used for this person (e.g., ["John Smith", "John", "Mr. Smith"]). MUST include the canonicalName itself!
   - "gender": MUST be exactly one of these three English words: "male", "female", or "unknown".
     * If pronouns are he/him/his -> "male"
     * If pronouns are she/her/hers -> "female"
     * "System" is always -> "female"
     * If absolutely no clue -> "unknown"
     * NEVER translate the gender words.

5. MERGING VARIATIONS:
   - If "The Dark Lord" and "Azaroth" are clearly the exact same person speaking, put both in the "variations" array of one character.

6. AGGRESSIVE CHARACTER EXTRACTION:
   - CRITICAL: Extract EVERY named character who speaks, even mentors, shopkeepers, or background characters.
   - Do NOT ignore secondary characters who speak frequently to the protagonist.
   - If they have dialogue, they MUST be extracted.
   - CRITICAL: Extract EVERY named character who speaks, even mentors, shopkeepers, or background characters. If they have dialogue, they MUST be extracted.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
Follow these steps IN ORDER:

Step 1: Speaker scan — Find every quote, bracket message, telepathy, or thought in the text.
Step 2: Speaker identify — Match each to a speaker via speech verbs, action beats, pronouns, or first-person narration.
Step 3: Vocative check — Verify names inside quotes are listeners, not speakers. Exclude them.
Step 4: Gender inference — Extract gender from pronouns (he/she) or context. Default to "unknown".
Step 5: Variation merge — If the same person appears with different names, consolidate into one entry with all variations.
Step 6: Output — Compile the final character list with canonical names, variations, and genders.`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/config/prompts/__tests__/extract.rules.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: update extract rules to use JSON reasoning field and aggressive character extraction"
```

---

### Task 3: Update Assign Rules Thinking Instructions

**Files:**
- Modify: `src/config/prompts/assign/rules.ts`
- Test: `src/config/prompts/__tests__/assign.rules.test.ts`

- [ ] Step 1: Write the failing test

```typescript
// src/config/prompts/__tests__/assign.rules.test.ts
import { describe, it, expect } from 'vitest';
import { ASSIGN_RULES } from '../assign/rules';

describe('ASSIGN_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(ASSIGN_RULES).toContain('Write your step-by-step work inside the JSON "reasoning" field');
    expect(ASSIGN_RULES).not.toContain('<thinking_process>');
    expect(ASSIGN_RULES).not.toContain('</thinking_process>');
    expect(ASSIGN_RULES).not.toContain('Write your work inside <thinking> tags');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/config/prompts/__tests__/assign.rules.test.ts -v`
Expected: FAIL with "expected string to contain 'Write your step-by-step work inside the JSON'"

- [ ] Step 3: Write minimal implementation

```typescript
// src/config/prompts/assign/rules.ts
// Replace the entire file content:

// src/config/prompts/assign/rules.ts
// Pipeline stage 3 of 3: Extract → Merge → Assign

export const ASSIGN_RULES = `1. SKIP NON-DIALOGUE:
   If a paragraph is just narration and NO ONE is speaking or thinking, IGNORE IT. Do not put its number in the JSON.

2. SYSTEM MESSAGES = SYSTEM:
   If the text is a game message in brackets like [Level Up!], assign it to the System code.

3. EXPLICIT TAGS (EASIEST):
   Look for "said X", "asked Y".
   Example: "Hello," said John. -> Assign to John's code.
   Example: "Hi," he said. -> Look at who "he" is based on the previous sentences.

4. ACTION BEATS:
   If a character does an action right before/after the quote, they are the speaker.
   Example: Mary smiled. "Welcome." -> Assign to Mary's code.

5. VOCATIVE TRAP (WARNING):
   A name INSIDE the quotes is usually the person being spoken TO, not the speaker!
   Example: "John, run!" -> John is NOT speaking. The other person in the scene is speaking.

6. FIRST PERSON:
   If the text says "I said", assign it to the "Protagonist" code.

7. NEGATIVE INDICES ARE READ-ONLY:
   Paragraphs labeled with negative indices inside the previous context block are from the previous section for context only. Do NOT assign speaker codes to them.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
Follow these steps IN ORDER:

Step 1: Dialogue scan — Identify every paragraph with quotes, thoughts, or system bracket messages.
Step 2: Speaker match — Use speech verbs ("said X"), action beats, pronouns, and first-person narration to identify speakers.
Step 3: Vocative check — Names inside quotes are listeners, not speakers. Cross them off.
Step 4: Context check — Use paragraph sequence and previous context (negative indices) for ambiguous cases.
Step 5: Output — Map paragraph numbers to speaker codes. Skip pure narration. Only assign non-negative indices.`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/config/prompts/__tests__/assign.rules.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: update assign rules to use JSON reasoning field instead of XML tags"
```

---

### Task 4: Reduce Assign Block Tokens for Cognitive Load

**Files:**
- Modify: `src/config/index.ts`
- Test: `src/config/__tests__/config.test.ts`

**Common Pitfalls:**
- This change affects block splitting - smaller blocks mean more API calls but less cognitive overload
- `maxConcurrentRequests` can be increased since blocks are smaller

- [ ] Step 1: Write the failing test

```typescript
// src/config/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../index';

describe('LLM Config', () => {
  it('should have assignBlockTokens set to 3000 to reduce cognitive overload', () => {
    expect(defaultConfig.llm.assignBlockTokens).toBe(3000);
  });

  it('should have extractBlockTokens set to 8000 (reduced from 16000)', () => {
    expect(defaultConfig.llm.extractBlockTokens).toBe(8000);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/config/__tests__/config.test.ts -v`
Expected: FAIL with "expected 8000 to be 3000"

- [ ] Step 3: Write minimal implementation

```typescript
// src/config/index.ts
// Update the llm config section (around line 85-95):

  llm: {
    extractBlockTokens: 8000,   // Down from 16000
    assignBlockTokens: 3000,    // Down from 8000 (Very important!)
    maxConcurrentRequests: 3,   // Can safely increase since blocks are smaller
    maxTokens: 8000,
    maxAssignRetries: 3,
    maxMergeRetries: 5,
    mergeVoteCount: 5,
  },
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/config/__tests__/config.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: reduce assignBlockTokens to 3000 and extractBlockTokens to 8000"
```

---

### Task 5: Add Tool Call Hallucination Scrubbing

**Files:**
- Modify: `src/utils/text.ts`
- Create: `src/utils/__tests__/text.toolcall.test.ts`

**Common Pitfalls:**
- The regex must handle both closed and unclosed `<tool_call>` tags
- Must not damage valid JSON that happens to contain similar patterns

- [ ] Step 1: Write the failing test

```typescript
// src/utils/__tests__/text.toolcall.test.ts
import { describe, it, expect } from 'vitest';
import { stripThinkingTags } from '../text';

describe('stripThinkingTags - tool call hallucinations', () => {
  it('should strip complete tool_call tags', () => {
    const input = 'Before <tool_call>json_tool_call<arg_key>value</arg_key></tool_call> After';
    expect(stripThinkingTags(input)).toBe('Before After');
  });

  it('should strip tool_call with attributes', () => {
    const input = 'Before <tool_call name="extract">content</tool_call> After';
    expect(stripThinkingTags(input)).toBe('Before After');
  });

  it('should handle multiple tool_call blocks', () => {
    const input = 'Start <tool_call>first</tool_call> Middle <tool_call>second</tool_call> End';
    expect(stripThinkingTags(input)).toBe('Start  Middle  End');
  });

  it('should not affect valid JSON with tool_call-like strings', () => {
    const input = '{"message": "Use tool_call for help"}';
    expect(stripThinkingTags(input)).toBe(input);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/utils/__tests__/text.toolcall.test.ts -v`
Expected: FAIL - tool_call tags not stripped

- [ ] Step 3: Write minimal implementation

```typescript
// src/utils/text.ts
// Update stripThinkingTags function (around line 155-175):

export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  return (
    text
      // Paired XML tags: <thinking>...</thinking>, <tool_call>...</tool_call>, etc.
      // (?:\s+[^>]*)? matches optional attributes like <tool_call name="extract_events">
      .replace(
        /<(think|thinking|thought|reasoning|reflection|tool_call|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
        '',
      )
      // Paired bracket tags: [THINK]...[/THINK], [TOOL_CALL]...[/TOOL_CALL], etc.
      .replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
      // Asterisk thinking: *thinks* or *thought*
      .replace(/\*thinks?:[\s\S]*?\*/gi, '')
      // Parenthesized thinking: (thinking: ...)
      .replace(/\(thinking:[\s\S]*?\)/gi, '')
      // Orphaned closing tags (opening tag was in assistant prefill)
      .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|tool_call|search)>\s*/i, '')
      // ideal_output: few-shot example wrapper that LLM sometimes reproduces after JSON
      .replace(/<\/ideal_output>\s*/gi, '')
      .trim()
  );
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/utils/__tests__/text.toolcall.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: add tool_call hallucination scrubbing to stripThinkingTags"
```

---

### Task 6: Add Unknown Speaker Code Fallback

**Files:**
- Modify: `src/services/llm/PromptStrategy.ts`
- Create: `src/services/llm/__tests__/PromptStrategy.fallback.test.ts`

**Common Pitfalls:**
- Must preserve existing behavior for valid codes
- Must fallback to UNKNOWN_UNNAMED only when code not found in context
- Need to handle the edge case where UNKNOWN_UNNAMED is not in the maps

- [ ] Step 1: Write the failing test

```typescript
// src/services/llm/__tests__/PromptStrategy.fallback.test.ts
import { describe, it, expect } from 'vitest';
import { parseAssignResponse } from '../PromptStrategy';

describe('parseAssignResponse - unknown code fallback', () => {
  const createContext = (codes: Record<string, string>) => ({
    characters: [],
    nameToCode: new Map(Object.entries(codes)),
    codeToName: new Map(Object.entries(codes).map(([k, v]) => [v, k])),
    numberedParagraphs: '',
    sentenceCount: 0,
  });

  it('should map valid codes normally', () => {
    const context = createContext({ John: '1', Mary: '2', UNKNOWN_UNNAMED: '3' });
    const response = { assignments: { '0': '1', '1': '2' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('1');
    expect(result.speakerMap.get(1)).toBe('2');
  });

  it('should fallback to UNKNOWN_UNNAMED when code is not recognized', () => {
    const context = createContext({ John: '1', UNKNOWN_UNNAMED: '3' });
    const response = { assignments: { '0': '1', '1': '999' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('1');
    expect(result.speakerMap.get(1)).toBe('3'); // Falls back to UNKNOWN_UNNAMED
  });

  it('should fallback to code "3" when UNKNOWN_UNNAMED not in maps', () => {
    const context = createContext({ John: '1' }); // No UNKNOWN_UNNAMED defined
    const response = { assignments: { '0': '999' }, reasoning: null };
    const result = parseAssignResponse(response, context);
    expect(result.speakerMap.get(0)).toBe('3'); // Hardcoded fallback
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/services/llm/__tests__/PromptStrategy.fallback.test.ts -v`
Expected: FAIL - unknown codes return undefined instead of fallback

- [ ] Step 3: Write minimal implementation

```typescript
// src/services/llm/PromptStrategy.ts
// Update parseAssignResponse function (around line 45-55):

export function parseAssignResponse(response: unknown, context: AssignContext): AssignResult {
  const parsed = AssignSchema.parse(response);

  const speakerMap = new Map<number, string>();
  for (const [key, code] of Object.entries(parsed.assignments)) {
    const index = parseInt(key, 10);
    if (context.codeToName.has(code)) {
      speakerMap.set(index, code);
    } else {
      // FIX: If the model hallucinates a code, fallback to UNKNOWN rather than dropping
      speakerMap.set(index, context.nameToCode.get('UNKNOWN_UNNAMED') || '3');
    }
  }

  return { speakerMap };
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/services/llm/__tests__/PromptStrategy.fallback.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: add fallback to UNKNOWN_UNNAMED for hallucinated speaker codes"
```

---

### Task 7: Safer Header Handling in LLMApiClient

**Files:**
- Modify: `src/services/llm/LLMApiClient.ts`
- Test: `src/services/llm/__tests__/LLMApiClient.headers.test.ts`

**Common Pitfalls:**
- Must preserve Authorization header
- Must not break existing browser fingerprinting for test mode
- Headers must be properly initialized from init.headers

- [ ] Step 1: Write the failing test

```typescript
// src/services/llm/__tests__/LLMApiClient.headers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { LLMApiClient } from '../LLMApiClient';

describe('LLMApiClient header handling', () => {
  it('should properly initialize headers from existing init.headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    global.fetch = mockFetch;

    const client = new LLMApiClient({
      apiKey: 'test-key',
      apiUrl: 'https://api.test.com',
      model: 'test-model',
    });

    // Trigger a request
    try {
      await client.testConnection();
    } catch {
      // Ignore response, we're checking headers
    }

    const call = mockFetch.mock.calls[0];
    const headers = call[1]?.headers as Headers;

    // Should have Content-Type
    expect(headers.get('Content-Type')).toBe('application/json');

    // Should have Authorization
    expect(headers.get('Authorization')).toContain('test-key');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/services/llm/__tests__/LLMApiClient.headers.test.ts -v`
Expected: FAIL - headers not properly initialized

- [ ] Step 3: Write minimal implementation

```typescript
// src/services/llm/LLMApiClient.ts
// Update customFetch in constructor (around line 65-75):

    const customFetch: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers); // Better initialization - copy existing

      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      // Ensure Authorization is preserved
      if (!headers.has('Authorization') && init?.headers) {
        const existingHeaders = new Headers(init.headers);
        const auth = existingHeaders.get('Authorization');
        if (auth) headers.set('Authorization', auth);
      }

      // ... rest of existing logic
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/services/llm/__tests__/LLMApiClient.headers.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: safer header initialization in LLMApiClient custom fetch"
```

---

### Task 8: Run Full Test Suite

**Files:**
- All modified files

- [ ] Step 1: Run full test suite

Run: `npm test`
Expected: All tests pass (or existing failures remain, no new failures)

- [ ] Step 2: Run type check

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] Step 3: Commit any final changes

```bash
git add -A && git commit -m "test: verify all fixes pass test suite and type check"
```

---

## Summary

This plan addresses all 5 issues from the design document:

1. **XML/JSON Conflict**: Changed `DEFAULT_PREFILL` to `'none'` and updated rules to use JSON reasoning field
2. **Cognitive Overload**: Reduced `assignBlockTokens` from 8000 to 3000 and `extractBlockTokens` from 16000 to 8000
3. **Missing Character**: Added aggressive extraction rules and fallback to UNKNOWN_UNNAMED
4. **Tool Call Hallucinations**: Enhanced `stripThinkingTags` with `<tool_call>` regex
5. **Header Safety**: Improved header initialization in `LLMApiClient`

---

**Plan written to `docs/plans/2025-03-30-fix-llm-pipeline-errors.md`. Please review and let me know if you want changes.**
