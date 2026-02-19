# EdgeTTS Project Context

## Overview
A local-first Text-to-Speech app using Edge TTS, FFmpeg (WASM), and LLMs for character voice assignment.
**Stack:** TypeScript, Preact (via Vite/Webpack), Tailwind CSS, IndexedDB, @preact/signals.

## Core Architecture
1. **Input:** File/Text -> `TextBlockSplitter`
2. **Analysis:** LLM Service -> Extract Chars -> Assign Speakers
3. **Pipeline:** `ConversionOrchestrator` -> Runs steps (Extract, Assign, TTS, Merge)
4. **TTS:** `TTSWorkerPool` -> Edge TTS WebSocket -> Audio Chunks (fs: `_temp_work`)
5. **Merge:** `AudioMerger` -> FFmpeg (Opus/MP3) -> Final File

## Key Commands
- `npm run dev`: Start dev server (Webpack)
- `npm run build`: Production build
- `npm test`: Run unit tests (Vitest)
- `npm run test:real`: Run integration tests against real LLM APIs
- `npm run typecheck`: TypeScript validation

## Code Standards
- **Async:** Use `async/await`. Handle known errors with `AppError` class.
- **Imports:** Use `@/` alias for `src/`.
- **Formatting:** Prettier/ESLint defaults apply.
- **Filesystem:** Browser File System Access API is used heavily. Always handle permission errors via `withPermissionRetry`.

## Directory Map
- `src/di`: Dependency Injection container (`ServiceContainer`).
- `src/services/pipeline`: Core conversion logic using Step pattern.
- `src/services/llm`: Prompt engineering and API interaction.
- `src/stores`: Global state (`@preact/signals`).
- `src/components`: UI components.