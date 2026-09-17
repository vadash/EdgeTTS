# ADR-0015: LLM stages become a stage-aware closure factory

Date: 2026-09-16
Status: Accepted
Absorbs the former llm-stage-transport-seam ADR in full: that file kept a duplicate number 0014 and is deleted; its live wording is folded in below.

## Context

ADR-0014 introduced `transport` as the seam for LLM structured calls, but the stages still lived on the `LLMVoiceService` class: one mutable instance carried `abortController`, cached `LLMApiClient`s, and per-stage option bags. The orchestrator created up to two service instances per run (extract, then assign with different options), managed the abort bridge with `addEventListener`/`finally`, and tests had to construct classes to exercise stage logic.

Cancellation also had two channels: the caller's `AbortSignal` (per call) and the service's internal `abortController` reachable through `service.cancel()`. Two channels for one concept invited drift.

## Decision

`src/services/llm/stages.ts` (renamed from `LLMVoiceService.ts`) exports `createLlmStages(deps: LlmStageDeps): LlmStages` — a closure factory over one stages record:

```ts
export type LlmPassId = 'extract' | 'assign' | 'qa' | 'merge' | 'test';
export interface LlmStages {
  extract(blocks: TextBlock[], p?: StageCall): Promise<LLMCharacter[]>;
  assign(blocks: TextBlock[], voiceMap: Map<string, string>, characters: LLMCharacter[], p?: StageCall): Promise<SpeakerAssignment[]>;
  merge(characters: LLMCharacter[], p?: StageCall): Promise<LLMCharacter[]>;
  testConnection(streaming?: boolean): Promise<{ success: boolean; error?: string; model?: string }>;
}
```

- **Stage methods are the interface; the injected transport is the seam** (the former transport-seam ADR's wording, kept verbatim). `transport?: (config, opts) => Promise<T>` on `LlmStageDeps` swaps the whole SDK path; when absent, `LLMApiClient` adapters are built and cached per resolved config.
- **Per-stage raw configs** (`extract`/`assign`/`merge`/`backup?`) use the nested config shape: connection triple required, tuning optional. The module resolves its own adapter slices; callers no longer flatten per-stage option bags.
- **Cancellation has one channel**: every stage takes `p?: StageCall` with `{ signal?, onProgress? }`. The caller's signal is the only cancellation path; `cancel()` is deleted, and the orchestrator's abort bridge (`addEventListener`/`finally`) is gone with it.
- **Stage tags ride the transport options** (`opts.stage: LlmPassId`, distinguishing `'assign'` from `'qa'`), so one injected transport can route or observe per pass.
- **Speaker-code numbering helpers** (`formatNumberedParagraphs`, `renumberParagraphs`, `shiftAssignmentKey`, `[i]` prefix) moved to `src/config/prompts/shared/numbering.ts` beside the prompt builders that consume them.
- **Speaker codes are injectable** via `speakerCodeFactory` on `LlmStageDeps`, so tests pin the code mapping without patching `CharacterUtils`.
- **The rate-limit gate stays process-global inside the adapter** ([ADR-0012](0012-process-global-rate-limit-gate.md) is unaffected); `testLlmConnection` on the transport path reports `no client` — no SDK client exists to probe.
- **Connection testing** (`testLlmConnection({ config, logger }, streaming?)`) is a standalone function; `LLMTab` probes a config directly instead of constructing a throwaway service.

## Consequences

- `ConversionOrchestratorServices.llmServiceFactory` is retyped to `llmStagesFactory: { create(deps: LlmStageDeps): LlmStages }`; exactly one stages record is created per run, and per-pass progress flows through `p.onProgress`.
- The class, `createLLMService`, and `LLMServiceFactoryOptions` are deleted with no aliases; `MockLLMService` and all LLM test helpers construct the record shape.
- Mutability dropped from the public surface: no shared `abortController`, no instance-level reset between passes. Debug-log reset happens per pass inside the closures.
- Transport consumers can now tag traffic per stage (`opts.stage`), enabling per-pass routing (e.g. QA to a cheaper model) without touching stage internals.
