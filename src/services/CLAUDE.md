# Services & Architecture

## Dependency Injection
- This project uses a custom DI container (`src/di/ServiceContainer.ts`).
- **Registration:** Register services in `src/di/ServiceContainer.ts`.
- **Consumption:** Use `useService(ServiceTypes.Name)` in hooks or constructor injection in classes.

## The Conversion Pipeline
Located in `src/services/pipeline/`.
- **Pattern:** Sequential Step pattern.
- **Data Flow:** `PipelineContext` is passed and mutated through steps.
- **Resume:** State is saved to `_temp_work/pipeline_state.json`. `resumeCheck.ts` handles logic.

## Critical Services
- **TTSWorkerPool:** Manages concurrency (`p-queue`) and WebSocket connections (`generic-pool`). Handles "Ladder" logic (scaling up/down based on success).
- **AudioMerger:** Handles FFmpeg (WASM). *Note:* reads/writes to disk immediately to prevent OOM.
- **KeepAwake:** Prevents browser throttling using AudioContext and WakeLock.

## Error Handling
- Use `AppError` for typed errors.
- Network calls should use `withRetry` utility (`src/utils/asyncUtils.ts`).