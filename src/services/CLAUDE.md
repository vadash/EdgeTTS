# Services & Logic Guidelines

## Dependency Injection (DI)
- **Pattern:** Inversify-lite style (`src/di/ServiceContainer.ts`).
- **Registration:** All services must be registered in `src/di/ServiceContext.tsx`.
- **Usage:** In React components, use `useService(ServiceTypes.Name)`. In classes, inject via constructor.
- **Interfaces:** Always define interfaces in `interfaces.ts` before implementing classes.

## Pipeline Architecture
- Located in `src/services/pipeline`.
- **Steps:** Logic is broken into discrete steps (e.g., `TTSConversionStep`, `AudioMergeStep`).
- **Context:** Data flows via `PipelineContext` object. Steps read from it and return a modified copy.
- **Lazy Loading:** Steps should not hold heavy data in memory; write to `tempDirHandle` immediately.

## Audio & FFmpeg
- **FFmpeg:** Loaded lazily via `FFmpegService`. Always check `isAvailable()` before use.
- **Merging:** Use `AudioMerger`. Do not load all chunks into RAM. Read from disk -> Process -> Write to disk.

## LLM Integration
- **Strategies:** Use `PromptStrategy` pattern for different tasks (Extract, Merge, Assign).
- **Retry:** Use `LLMApiClient` with `p-retry` for robust API calls.