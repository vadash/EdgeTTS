# Parallel LLM Stages via Shared PQueue Helper

**Date:** 2026-04-16
**Status:** Approved

## Problem

The Extract and Assign LLM stages process text blocks sequentially or in fixed-size batches, leaving throughput on the table:

- **Extract** (`extractCharacters`): Strictly sequential `for` loop. Block N+1 waits for Block N.
- **Assign** (`assignSpeakers`): Batched `Promise.all` with window = `llmThreads`. Suffers from the "slowest ship" problem — fast slots sit idle waiting for the slowest in the batch.
- **Merge** (`mergeCharactersWithLLM`): Sequential 5-way voting. Only 5 calls total; not a bottleneck.

There are zero data dependencies between blocks in both Extract and Assign, making them safe for true concurrent execution.

## Solution

Replace the sequential loop (Extract) and batched `Promise.all` (Assign) with a shared `runWithConcurrency` helper backed by `p-queue`. Merge stays sequential — its 5 vote calls are cheap and its consensus algorithm is simpler to reason about sequentially.

### Shared helper: `runWithConcurrency`

New file `src/services/llm/runWithConcurrency.ts`:

```typescript
import PQueue from 'p-queue';

export interface ConcurrencyOptions {
  concurrency: number;
  signal: AbortSignal;
  onProgress?: (completed: number, total: number, message?: string) => void;
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  options: ConcurrencyOptions,
): Promise<T[]> {
  const { concurrency, signal, onProgress } = options;
  const queue = new PQueue({ concurrency });
  const results: T[] = [];
  let completed = 0;

  const promises = tasks.map((task) =>
    queue.add(async () => {
      if (signal.aborted) throw new Error('Operation cancelled');
      const result = await task();
      completed++;
      onProgress?.(completed, tasks.length);
      return result;
    }),
  );

  return Promise.all(promises);
}
```

Key properties:
- **Abort check** at task start — queued tasks that wake after cancellation throw immediately.
- **Progress fires per-completion** — smooth incremental UI updates instead of per-batch jumps.
- **Results order** matches input task order (Promise.all preserves insertion order).
- **Concurrency** comes from the existing `llmThreads` setting (default 2).

### Extract refactor

Extract the loop body into a private `extractBlock` method, then call `runWithConcurrency`:

```typescript
const tasks = blocks.map((block, i) => () =>
  this.extractBlock(block, i, blocks.length, controller)
);

const responses = await runWithConcurrency(tasks, {
  concurrency: this.options.maxConcurrentRequests ?? 2,
  signal: controller.signal,
  onProgress: (completed, total) => onProgress?.(completed, total),
});
```

`extractBlock(block, index, total, controller)` returns the raw LLM response. Debug logging uses `index === 0` instead of a mutable flag.

The post-processing (`mergeCharacters`, `cullByFrequency`, `mergeCharactersWithLLM`) runs on the collected results — unchanged.

### Assign refactor

Replace the batched `for + Promise.all` loop with:

```typescript
const tasks = blocks.map((block, globalIndex) => () => {
  const overlapSentences = globalIndex > 0
    ? blocks[globalIndex - 1].sentences.slice(-OVERLAP_SIZE)
    : undefined;
  return this.processAssignBlock(
    block, characterVoiceMap, characters,
    nameToCode, codeToName, overlapSentences,
    /* isFirstBlock */ globalIndex === 0,
  );
});

const batchResults = await runWithConcurrency(tasks, {
  concurrency: maxConcurrent,
  signal: this.abortController.signal,
  onProgress: (completed, total) => onProgress?.(completed, total),
});

results.push(...batchResults.flat());
results.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
```

### `processAssignBlock` signature change

Add `isFirstBlock: boolean` parameter. Remove the `this.isFirstAssignBlock` field entirely. This fixes an existing race condition where parallel tasks could both see `isFirstAssignBlock === true` and attempt concurrent debug log writes.

### Merge — no changes

`mergeCharactersWithLLM` and `singleMerge` remain sequential.

### Error handling

- Individual task failures propagate via `Promise.all` — first failure rejects the whole stage (matches current behavior).
- `withRetry` inside each task still handles transient 429s/network errors per-block.
- Abort signal checked both by PQueue (task start) and `withRetry` (inside API call).

### Rate limiting

No artificial inter-request delay. The PQueue enforces concurrency via `llmThreads`. Existing `withRetry` (backed by `p-retry` with exponential backoff) handles HTTP 429 responses. Users on free-tier APIs may see more retry warnings but won't experience failures.

## Files changed

| File | Change |
|------|--------|
| `src/services/llm/runWithConcurrency.ts` | **New** — shared helper + types |
| `src/services/llm/runWithConcurrency.test.ts` | **New** — unit tests for the helper |
| `src/services/llm/LLMVoiceService.ts` | Refactor `extractCharacters` (PQueue via helper), `assignSpeakers` (PQueue via helper), `processAssignBlock` (add `isFirstBlock` param, remove mutable field) |

## Testing strategy

- **New:** Unit test `runWithConcurrency` directly — verify concurrency limit, abort behavior, progress callbacks, result ordering.
- **Existing:** `extract.test.ts`, `assign.test.ts`, `assignWithQA.test.ts` should pass unchanged — public API signatures don't change, only internal concurrency.
- **Test infra:** PQueue mock in `src/test/setup.ts` already exists (executes tasks immediately), so existing tests remain valid.
