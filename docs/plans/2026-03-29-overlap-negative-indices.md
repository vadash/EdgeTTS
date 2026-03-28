# Overlap with Negative Indices Implementation Plan

**Goal:** Pass the last 5 sentences of the previous block as read-only context to each Assign block, labeled with negative indices `[-5]` through `[-1]`.
**Architecture:** Add a new optional parameter `overlapSentences` to `buildAssignPrompt()` and `processAssignBlock()`. The `assignSpeakers()` loop extracts overlap from the pre-split `TextBlock` array — no sequential dependency, parallel batch processing unchanged.
**Tech Stack:** TypeScript, Vitest

---

### File Structure Overview

- Modify: `src/config/prompts/assign.ts` — add `{{previousContext}}` placeholder and negative-index rule
- Modify: `src/services/llm/PromptStrategy.ts` — accept overlap sentences, compute negative indices, inject into prompt
- Modify: `src/services/llm/LLMVoiceService.ts` — pass overlap sentences through the call chain
- Test: `src/services/llm/PromptStrategy.test.ts` — add tests for overlap injection

---

### Task 1: Add `{{previousContext}}` placeholder to the assign prompt template

**Files:**
- Modify: `src/config/prompts/assign.ts`
- Test: `src/services/llm/PromptStrategy.test.ts`

**Common Pitfalls:**
- The `{{previousContext}}` placeholder must be replaced BEFORE `{{paragraphs}}` is replaced, or the overlap text could be corrupted if it contains `{{...}}` patterns. However, since `replace('{{paragraphs}}', ...)` only matches the exact string `{{paragraphs}}`, the order does not matter. Just be aware.
- Do NOT add any text inside the `<previous_context_do_not_assign>` tag in the template — that content is dynamic and injected by `buildAssignPrompt()`.

- [ ] Step 1: Write the failing test

Add to `src/services/llm/PromptStrategy.test.ts`, inside the existing `describe('Prompt builders accept detectedLanguage', ...)` block or as a new describe block:

```typescript
describe('buildAssignPrompt with overlap', () => {
  const characters: LLMCharacter[] = [
    { canonicalName: 'Alice', variations: ['Alice'], gender: 'female' },
  ];
  const nameToCode = new Map([['Alice', 'A']]);
  const numberedParagraphs = '[0] Some text';

  it('injects overlap sentences with negative indices when provided', () => {
    const overlapSentences = ['Third to last.', 'Fourth to last.', 'Fifth to last.', 'Second to last.', 'Last sentence.'];
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', overlapSentences);
    const userMessage = result[1].content as string;
    expect(userMessage).toContain('<previous_context_do_not_assign>');
    expect(userMessage).toContain('[-5] Fifth to last.');
    expect(userMessage).toContain('[-4] Fourth to last.');
    expect(userMessage).toContain('[-3] Third to last.');
    expect(userMessage).toContain('[-2] Second to last.');
    expect(userMessage).toContain('[-1] Last sentence.');
    expect(userMessage).toContain('</previous_context_do_not_assign>');
  });

  it('omits overlap section when overlapSentences is empty array', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', []);
    const userMessage = result[1].content as string;
    expect(userMessage).not.toContain('<previous_context_do_not_assign>');
    expect(userMessage).not.toContain('[-1]');
  });

  it('omits overlap section when overlapSentences is not provided (undefined)', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en');
    const userMessage = result[1].content as string;
    expect(userMessage).not.toContain('<previous_context_do_not_assign>');
    expect(userMessage).not.toContain('[-1]');
  });

  it('handles fewer than 5 overlap sentences', () => {
    const overlapSentences = ['Second to last.', 'Last sentence.'];
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', overlapSentences);
    const userMessage = result[1].content as string;
    expect(userMessage).toContain('<previous_context_do_not_assign>');
    expect(userMessage).toContain('[-2] Second to last.');
    expect(userMessage).toContain('[-1] Last sentence.');
    expect(userMessage).not.toContain('[-3]');
  });

  it('includes recency-bias note after numbered paragraphs', () => {
    const result = buildAssignPrompt(characters, nameToCode, numberedParagraphs, 'en', ['Some overlap.']);
    const userMessage = result[1].content as string;
    const paragraphsPos = userMessage.indexOf('<numbered_paragraphs>');
    const notePos = userMessage.indexOf('[0] and above');
    expect(notePos).toBeGreaterThan(paragraphsPos);
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/llm/PromptStrategy.test.ts`
Expected: FAIL — `buildAssignPrompt` does not accept a 5th argument yet, and `{{previousContext}}` is not in the template.

- [ ] Step 3: Update `src/config/prompts/assign.ts`

Add a new rule to the `rules` string. Append after rule 6:

```
7. NEGATIVE INDICES ARE READ-ONLY:
   Paragraphs labeled with negative indices ([-5] through [-1]) inside <previous_context_do_not_assign> are from the previous section for context only. Do NOT assign speaker codes to them.
```

Update `userTemplate` to include `{{previousContext}}` and the recency-bias note:

```typescript
userTemplate: `<speaker_codes>
{{characterLines}}
{{unnamedEntries}}
</speaker_codes>

{{previousContext}}

<numbered_paragraphs>
{{paragraphs}}
</numbered_paragraphs>

Assign the correct speaker code (A, B, C...) to each paragraph number.
- ONLY use the codes provided above. DO NOT use names.
- SKIP any paragraphs that do not contain dialogue, thoughts, or system brackets.
- Watch out for names inside quotes (they are listeners, not speakers).
- Only assign speaker codes to paragraphs [0] and above.`,
```

The key changes to `userTemplate`:
1. `{{previousContext}}` added between `</speaker_codes>` and `<numbered_paragraphs>`
2. New bullet at the bottom: `- Only assign speaker codes to paragraphs [0] and above.` (recency bias note)

- [ ] Step 4: Update `buildAssignPrompt()` in `src/services/llm/PromptStrategy.ts`

Add the `overlapSentences` parameter and compute the previous context string:

```typescript
export function buildAssignPrompt(
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  numberedParagraphs: string,
  detectedLanguage: string = 'en',
  overlapSentences?: string[],
): LLMMessage[] {
  const p = LLM_PROMPTS.assign;

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

  // Build overlap context with negative indices
  let previousContext = '';
  if (overlapSentences && overlapSentences.length > 0) {
    const count = overlapSentences.length;
    const lines = overlapSentences.map((text, i) => `[${i - count}] ${text}`);
    previousContext = `<previous_context_do_not_assign>\n${lines.join('\n')}\n</previous_context_do_not_assign>`;
  }

  const sys = assembleSystemPrompt(p.role, p.examples);
  const constraints = assembleUserConstraints(p.rules, p.schemaText);
  const user = p.userTemplate
    .replace('{{paragraphs}}', numberedParagraphs)
    .replace('{{characterLines}}', characterLinesStr)
    .replace('{{unnamedEntries}}', unnamedEntriesStr)
    .replace('{{previousContext}}', previousContext);

  return buildMessages(sys, `${user}\n\n${constraints}`, detectedLanguage);
}
```

- [ ] Step 5: Run test to verify it passes

Run: `npx vitest run src/services/llm/PromptStrategy.test.ts`
Expected: PASS — all overlap tests and existing tests pass.

- [ ] Step 6: Commit

```bash
git add src/config/prompts/assign.ts src/services/llm/PromptStrategy.ts src/services/llm/PromptStrategy.test.ts
git commit -m "feat(assign): add overlap context with negative indices to assign prompt"
```

---

### Task 2: Wire overlap through `LLMVoiceService.assignSpeakers()` and `processAssignBlock()`

**Files:**
- Modify: `src/services/llm/LLMVoiceService.ts`
- Test: `src/services/llm/assign.test.ts`

**Common Pitfalls:**
- The `OVERLAP_SIZE` constant should live in `LLMVoiceService.ts` near the other constants (`VOTING_TEMPERATURES`, `LLM_DELAY_MS`, etc.).
- `blocks[N - 1]?.sentences.slice(-OVERLAP_SIZE)` — the optional chaining `?.` handles block 0 where `N - 1 = -1` (accessing `blocks[-1]` returns `undefined` in JavaScript). This naturally produces `undefined`, which `buildAssignPrompt` treats as "no overlap."
- Do NOT pass overlap for block 0 — the design says omit the tag entirely.

- [ ] Step 1: Write the failing test

Add to `src/services/llm/assign.test.ts`:

```typescript
it('passes overlap sentences from previous block to processAssignBlock', async () => {
  const callArgs: string[][] = [];

  const mockResponse = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            reasoning: null,
            assignments: { '0': 'A' },
          }),
          refusal: null,
        },
      },
    ],
    model: 'gpt-4o-mini',
  };

  const openai = await import('openai');
  const mockCreate = vi.fn().mockResolvedValue(mockResponse as any);
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

  // Spy on buildAssignPrompt to capture the overlapSentences argument
  const { buildAssignPrompt } = await import('./PromptStrategy');
  const spy = vi.spyOn({ buildAssignPrompt }, 'buildAssignPrompt');

  service = new LLMVoiceService({
    apiKey: 'test-key',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    narratorVoice: 'narrator-voice',
    logger: mockLogger,
  });

  const blocks: TextBlock[] = [
    {
      sentenceStartIndex: 0,
      sentences: ['"Hello," said Alice.', '"Hi," replied Bob.'],
      blockIndex: 0,
    },
    {
      sentenceStartIndex: 2,
      sentences: ['"How are you?" asked Alice.'],
      blockIndex: 1,
    },
  ];

  const voiceMap = new Map<string, string>([
    ['Alice', 'voice-a'],
    ['Bob', 'voice-b'],
  ]);

  await service.assignSpeakers(blocks, voiceMap, characters);

  // Block 0: no overlap (undefined)
  // Block 1: overlap from block 0's last 5 sentences (block 0 only has 2)
  // The spy should have been called twice
  expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);

  // First call (block 0) — no overlap
  expect(spy.mock.calls[0][4]).toBeUndefined();

  // Second call (block 1) — overlap from block 0
  expect(spy.mock.calls[1][4]).toEqual(['"Hello," said Alice.', '"Hi," replied Bob.']);
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run src/services/llm/assign.test.ts`
Expected: FAIL — `buildAssignPrompt` spy shows `undefined` for both calls because `processAssignBlock` doesn't pass overlap yet.

- [ ] Step 3: Implement the wiring in `LLMVoiceService.ts`

**A)** Add the constant near the other constants at the top of the file:

```typescript
const OVERLAP_SIZE = 5;
```

**B)** Update `assignSpeakers()` — inside the `batch.map()` callback, compute overlap and pass it to `processAssignBlock()`:

Change from:
```typescript
const batchPromises = batch.map((block, batchIndex) => {
  const blockNum = i + batchIndex + 1;
  this.logger?.info(`[assign] Starting block ${blockNum}/${blocks.length}`);
  return this.processAssignBlock(block, characterVoiceMap, characters, nameToCode, codeToName)
```

To:
```typescript
const batchPromises = batch.map((block, batchIndex) => {
  const blockNum = i + batchIndex + 1;
  const globalIndex = i + batchIndex;
  const overlapSentences = globalIndex > 0
    ? blocks[globalIndex - 1].sentences.slice(-OVERLAP_SIZE)
    : undefined;
  this.logger?.info(`[assign] Starting block ${blockNum}/${blocks.length}`);
  return this.processAssignBlock(block, characterVoiceMap, characters, nameToCode, codeToName, overlapSentences)
```

**C)** Update `processAssignBlock()` signature — add `overlapSentences` parameter:

Change from:
```typescript
private async processAssignBlock(
  block: TextBlock,
  characterVoiceMap: Map<string, string>,
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  codeToName: Map<string, string>,
): Promise<SpeakerAssignment[]> {
```

To:
```typescript
private async processAssignBlock(
  block: TextBlock,
  characterVoiceMap: Map<string, string>,
  characters: LLMCharacter[],
  nameToCode: Map<string, string>,
  codeToName: Map<string, string>,
  overlapSentences?: string[],
): Promise<SpeakerAssignment[]> {
```

**D)** Pass `overlapSentences` to `buildAssignPrompt()` inside `processAssignBlock()`:

Change:
```typescript
const assignMessages = buildAssignPrompt(
  context.characters,
  context.nameToCode,
  context.numberedParagraphs,
  this.detectedLanguage,
);
```

To:
```typescript
const assignMessages = buildAssignPrompt(
  context.characters,
  context.nameToCode,
  context.numberedParagraphs,
  this.detectedLanguage,
  overlapSentences,
);
```

This `buildAssignPrompt` call appears in **two places** inside `processAssignBlock()`:
1. The voting path (inside the loop, around line ~350)
2. The non-voting path (single call, around line ~390)

Both must be updated.

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run src/services/llm/assign.test.ts`
Expected: PASS

- [ ] Step 5: Run full test suite to confirm no regressions

Run: `npx vitest run`
Expected: All tests PASS

- [ ] Step 6: Commit

```bash
git add src/services/llm/LLMVoiceService.ts src/services/llm/assign.test.ts
git commit -m "feat(assign): wire overlap sentences through assignSpeakers pipeline"
```
