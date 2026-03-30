# Fix LLM Pipeline Errors Implementation Plan

**Goal:** Fix the fundamental conflict between Structured Outputs and XML prefilling, reduce cognitive overload in Assign phase, and improve text scrubbing for tool call hallucinations.

**Architecture:** The LLM pipeline uses a 3-message topology (System → User → Assistant prefill). Currently the prefill uses `<thinking>` tags which conflict with OpenAI's `strict: true` JSON schema enforcement. The fix moves reasoning into the JSON "reasoning" field, reduces block sizes for Assign phase, and adds aggressive text scrubbing.

**Tech Stack:** TypeScript, Zod 4, OpenAI SDK, Vitest for testing.

---

## File Structure Overview

- **Modify:** `src/config/prompts/shared/preambles.ts` - Change default prefill from 'auto' to 'none'
- **Modify:** `src/config/prompts/extract/rules.ts` - Update thinking instructions to use JSON reasoning field
- **Modify:** `src/config/prompts/assign/rules.ts` - Update thinking instructions to use JSON reasoning field
- **Modify:** `src/config/prompts/merge/rules.ts` - Update thinking instructions to use JSON reasoning field
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

### Task 4: Update Merge Rules Thinking Instructions

**Files:**
- Modify: `src/config/prompts/merge/rules.ts`
- Test: `src/config/prompts/__tests__/merge.rules.test.ts`

**Common Pitfalls:**
- The Merge stage was missed in the initial design document but also uses `<thinking_process>` tags
- Must update to use JSON reasoning field like Extract and Assign stages

- [ ] Step 1: Write the failing test

```typescript
// src/config/prompts/__tests__/merge.rules.test.ts
import { describe, it, expect } from 'vitest';
import { MERGE_RULES } from '../merge/rules';

describe('MERGE_RULES', () => {
  it('should instruct model to write reasoning inside JSON field, not XML tags', () => {
    expect(MERGE_RULES).toContain('Write your step-by-step work inside the JSON "reasoning" field');
    expect(MERGE_RULES).not.toContain('<thinking_process>');
    expect(MERGE_RULES).not.toContain('</thinking_process>');
    expect(MERGE_RULES).not.toContain('Write your work inside <thinking> tags');
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/config/prompts/__tests__/merge.rules.test.ts -v`
Expected: FAIL with "expected string to contain 'Write your step-by-step work inside the JSON'"

- [ ] Step 3: Write minimal implementation

```typescript
// src/config/prompts/merge/rules.ts
// Replace the entire file content:

// src/config/prompts/merge/rules.ts
// Pipeline stage 2 of 3: Extract → Merge → Assign

export const MERGE_RULES = `1. CHECK VARIATIONS:
   Look at the "variations" arrays. If Character A and Character B share a name in their variations, they are the same person.
   Example: 0 has ["Marcus", "Marc"], 1 has ["Marcus Stone", "Marcus"]. They both have "Marcus". -> MERGE [1, 0].

2. PROTAGONIST LINKING:
   If one character is "Protagonist" and another is clearly the main character of the story (same gender/context), MERGE them.

3. SYSTEM LINKING:
   "System", "Interface", "Blue Box", "Notification" are all the same game system. -> MERGE them.

4. DIFFERENT PEOPLE (DO NOT MERGE):
   - If one is "male" and the other is "female", DO NOT MERGE. They are different people.
   - "The King" and "The Prince" are different roles. DO NOT MERGE.
   - "John" and "John's Father" are different people. DO NOT MERGE.
   - If you are not 100% sure, DO NOT MERGE.

5. HOW TO ORDER THE MERGE GROUP:
   A merge group must have AT LEAST 2 numbers.
   The FIRST number in the group must be the character with the longest, most complete, or best "canonicalName".
   Example: 0 is "Bob". 1 is "Robert Smith". The group should be [1, 0] because "Robert Smith" is better.
   Example: 3 is "System". 5 is "Interface". The group should be [3, 5] because "System" is the best name for game menus.

Write your step-by-step work inside the JSON "reasoning" field BEFORE outputting the data arrays/objects.
Follow these steps IN ORDER:

Step 1: Variation cross-check — Compare variations arrays between all character pairs. Flag any shared names.
Step 2: System entity match — Link System, Interface, Blue Box, Notification into one group.
Step 3: Protagonist match — If Protagonist exists, check if another character is the same person (main character).
Step 4: Conflict check — Reject any proposed merges with gender mismatches or insufficient confidence.
Step 5: Output — Build merge groups. First number = best/longest canonicalName. Empty array if no merges.`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/config/prompts/__tests__/merge.rules.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: update merge rules to use JSON reasoning field instead of XML tags"
```

---

### Task 5: Reduce Assign Block Tokens for Cognitive Load

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

### Task 6: Add Tool Call Hallucination Scrubbing (CRITICAL FIX)

**Files:**
- Modify: `src/utils/text.ts`
- Create: `src/utils/__tests__/text.toolcall.test.ts`

**⚠️ CRITICAL:** The naive regex approach would delete valid JSON inside `<tool_call>` tags. Instead, we must UNWRAP them so `extractJsonBlocks` can find the `{}` inside.

**Why this matters:** In `a20.json`, the model hallucinated:
```xml
<tool_call>...<arg_value>{"0": "A"}</arg_value></tool_call>
```
Blindly deleting would remove the valid JSON payload causing Tier 5 parse failures!

- [ ] Step 1: Write the failing test

```typescript
// src/utils/__tests__/text.toolcall.test.ts
import { describe, it, expect } from 'vitest';
import { stripThinkingTags } from '../text';

describe('stripThinkingTags - tool call hallucinations', () => {
  it('should unwrap tool_call containing JSON payload', () => {
    const input = 'Before <tool_call><arg_value>{"0": "A"}</arg_value></tool_call> After';
    expect(stripThinkingTags(input)).toBe('Before {"0": "A"} After');
  });

  it('should unwrap tool_call with namespaced tags', () => {
    const input = '<tool_call><json>{"key": "value"}</json></tool_call>';
    expect(stripThinkingTags(input)).toBe('{"key": "value"}');
  });

  it('should handle multiple tool_call blocks', () => {
    const input = 'Start <tool_call>{"a": 1}</tool_call> Middle <tool_call>{"b": 2}</tool_call> End';
    expect(stripThinkingTags(input)).toBe('Start {"a": 1} Middle {"b": 2} End');
  });

  it('should not affect valid JSON with tool_call-like strings', () => {
    const input = '{"message": "Use tool_call for help"}';
    expect(stripThinkingTags(input)).toBe(input);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test -- src/utils/__tests__/text.toolcall.test.ts -v`
Expected: FAIL - tool_call tags not unwrapped

- [ ] Step 3: Write minimal implementation

```typescript
// src/utils/text.ts
// Update stripThinkingTags function (around line 155-175):

export function stripThinkingTags(text: string): string {
  if (typeof text !== 'string') return text;
  return (
    text
      // 1. Unwrap rogue tool_call arguments that contain the JSON (CRITICAL: before stripping other tags!)
      .replace(/<tool_call>[\s\S]*?<arg_value>(\s*\{)/gi, '$1')
      .replace(/(\}\s*)<\/arg_value>[\s\S]*?<\/tool_call>/gi, '$1')

      // 2. NOW strip the standard paired XML tags (Removed 'tool_call' from this list!)
      .replace(
        /<(think|thinking|thought|reasoning|reflection|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
        '',
      )
      // 3. Paired bracket tags
      .replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
      // 4. Asterisk thinking
      .replace(/\*thinks?:[\s\S]*?\*/gi, '')
      // 5. Parenthesized thinking
      .replace(/\(thinking:[\s\S]*?\)/gi, '')
      // 6. Orphaned closing tags (tool_call removed - we unwrapped it instead!)
      .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|search)>\s*/i, '')
      // 7. ideal_output wrapper
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
git add -A && git commit -m "fix: unwrap tool_call hallucinations instead of deleting to preserve JSON"
```

---

### Task 7: Add Unknown Speaker Code Fallback

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

### Task 8: Safer Header Handling in LLMApiClient

**Files:**
- Modify: `src/services/llm/LLMApiClient.ts`
- Test: `src/services/llm/__tests__/LLMApiClient.headers.test.ts`

**⚠️ Note:** The `new Headers(init?.headers)` call already copies ALL headers including `Authorization`. The manual check and copy is redundant and has been removed. Also removed hardcoded User-Agent spoofing.

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
// Update customFetch in constructor (around line 65-90):

    const customFetch: typeof fetch = async (url, init) => {
      // Safely initialize and copy all existing headers (including Authorization)
      const headers = new Headers(init?.headers);

      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      // Detect test mode
      const isTestMode = typeof window === 'undefined' || typeof navigator === 'undefined';
      const origin = new URL(url.toString()).origin;

      if (!isTestMode) {
        // Browser mode - copy headers from current browser context
        headers.set('Accept', 'application/json, text/event-stream');
        if (navigator.userAgent) {
          headers.set('User-Agent', navigator.userAgent);
        }
        if (navigator.language) {
          headers.set('Accept-Language', navigator.language);
        }
        headers.set('Origin', origin);
        headers.set('Referer', `${origin}/`);
      }

      return fetch(url, { ...init, headers });
    };
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test -- src/services/llm/__tests__/LLMApiClient.headers.test.ts -v`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: simplify header initialization in LLMApiClient (redundant Authorization copy removed)"
```

---

### Task 9: Run Full Test Suite

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

This plan addresses all 5 issues from the design document with the critical fixes from review:

1. **XML/JSON Conflict**: Changed `DEFAULT_PREFILL` to `'none'` and updated Extract, Assign, and Merge rules to use JSON reasoning field
2. **Cognitive Overload**: Reduced `assignBlockTokens` from 8000 to 3000 and `extractBlockTokens` from 16000 to 8000
3. **Missing Character**: Added aggressive extraction rules and fallback to UNKNOWN_UNNAMED
4. **Tool Call Hallucinations**: **CRITICAL FIX** - Unwrap `<tool_call>` tags to preserve JSON payload inside instead of blindly deleting
5. **Header Safety**: Simplified header initialization (redundant Authorization copy removed)

---

**Plan written to `docs/plans/2025-03-30-fix-llm-pipeline-errors-v3.md`.** This version includes critical logic fixes for Task 6 (tool call unwrapping) and Task 8 (header simplification).
