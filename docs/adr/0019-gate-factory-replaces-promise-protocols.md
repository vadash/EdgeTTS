# A gate factory replaces the review and resume promise protocols

Date: 2026-09-17
Status: Accepted
Closes the review-gate debt named in [ADR-0014](0014-ports-not-stores-in-pipeline.md); builds on the single cancellation encoding of [ADR-0017](0017-one-cancellation-encoding.md).

## Context

Both user pauses in a Conversion — the Review gate (confirm the draft Voice map) and the Resume gate (continue a previous run or start fresh) — were a promise parked on a module-global resolver slot: `awaitReview`/`confirmReview`/`cancelReview` in LLMStore, `awaitResumeConfirmation`/`confirmResume`/`cancelResume` in ConversionStore. The completing side (ConvertView buttons) reached the resolvers directly, past the `ReviewGate`/`ResumeGate` ports ADR-0014 had installed. The review draft was the store itself: modal edits mutated live store state and survived a cancel. A second concurrent `awaitReview` silently clobbered the first slot.

## Decision

`src/stores/gates.ts` exports `createGate<P, T>(io: { settle, decline })` — a factory whose instances own the pause:

```ts
open(payload: P): Promise<T>;  // rejects if already open
confirm(): void;               // settles open() with io.settle(draft)
decline(): void;               // settles open() with io.decline(); a throw rejects open(), never escapes decline()
patch(partial: Partial<P>): void;
state: Signal<{ open: boolean; draft: P | null }>;
```

- **reviewGate**: the draft is `{ characters, voiceMap, assignments, profile, lineCounts }`, seeded by the adapter in `ports.review.open`. `settle` writes the LLM store once (characters, voiceMap, assignments, profile) and returns `{ voiceMap, profile }` — the port contract is unchanged. `decline` throws `CancellationError` (ADR-0017): cancelling review cancels the run, and draft edits die with it.
- **resumeGate**: `settle` returns `true`, `decline` returns `false`. A declined resume is a legitimate outcome — the run continues fresh — not a cancellation.

The stores keep plain setters. `pendingReview`, `resumeInfo`, and both resolver pairs are deleted. VoiceReviewModal receives `draft` + `patch` props instead of reading the LLM store.

## Consequences

- The single-slot rule becomes one local promise per gate instance; a second `open` while open is a rejected promise, not silent clobbering.
- Store character data is written once at confirm; during review the modal reads the draft. Cancel discards draft edits — safe because review-cancel always cancels the run.
- Confirm-time store writes are persistence-free (the target setters are pure `patchState`), so no debounced save fires.
- LLMStore's `characterLineCounts` computed is unchanged: `speakerAssignments` already reach the store pre-review via the `characters` port; the draft carries a `lineCounts` snapshot for the modal.
- The adapter's two ports are one-liners; ADR-0014's layering — the pipeline never sees stores — is intact and now true on the completing side too.
