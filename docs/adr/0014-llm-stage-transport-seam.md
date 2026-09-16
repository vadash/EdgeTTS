# Stage methods are the interface; the injected transport is the seam

`LLMVoiceService` exposes its pipeline stages — `extractCharacters`, `mergeCharacters`, `assignSpeakers` — as the public surface. The OpenAI SDK path (`LLMApiClient` with the rate-limit gate, wire-shape build, and debug logging) is a production adapter behind an injected `transport` function on `LLMVoiceServiceOptions`.

## Consequences

- Stage tests stub the injected transport with canned parsed objects (routing on the resolved config's `model` and call order); they never mock the OpenAI SDK and never construct `LLMApiClient`.
- The service resolves per-stage client configs (primary, backup, merge votes) exactly as before and routes every structured call through one internal helper: the injected transport when present, otherwise a cached `LLMApiClient` keyed by the resolved config. The rate-limit gate stays process-global inside the adapter (ADR 0012 is unaffected).
- The public `apiClient`/`backupApiClient` fields are gone; clients are private and built only when no transport is injected. `testConnection` reports `no client` on the transport path.
- Speaker codes are injectable via `speakerCodeFactory` so tests can pin the code mapping without patching `CharacterUtils`.

## Addendum (2026-09-16, ADR-0015)

The service dissolved into the `createLlmStages(deps)` closure factory in `src/services/llm/stages.ts`; the options interface is renamed `LlmStageDeps` and the public surface is the `LlmStages` record (`extract`/`assign`/`merge`/`testConnection`). Transport options carry an optional `stage: LlmPassId` tag so one injected transport can route per pass. The wording above — "Stage methods are the interface; the injected transport is the seam" — is unchanged in spirit. See [ADR-0015](0015-llm-stages-closure-factory.md).
