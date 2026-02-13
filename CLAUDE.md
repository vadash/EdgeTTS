# EdgeTTS Project Context

## Overview
A local-first Text-to-Speech app using Edge TTS, FFmpeg (WASM), and LLMs for character voice assignment.
**Stack:** TypeScript, Preact (via Vite), Tailwind CSS, IndexedDB (Storage), @preact/signals (State).

## Commands
- **Run Dev:** `npm run dev`
- **Build:** `npm run build`
- **Test:** `npm test` (Vitest)
- **Test Real LLM:** `npm run test:real` (Requires API keys)
- **Typecheck:** `npm run typecheck`

## Architecture Data Flow
1. **Input:** File/Text -> `TextBlockSplitter`
2. **Analysis:** LLM Service -> Extract Chars -> Assign Speakers
3. **Pipeline:** `ConversionOrchestrator` -> Runs steps (Extract, Assign, TTS, Merge)
4. **TTS:** `TTSWorkerPool` -> Edge TTS WebSocket -> Audio Chunks (saved to temp FS)
5. **Merge:** `AudioMerger` -> FFmpeg (Opus/MP3) -> Final File

## Key Directories
- `src/di`: Dependency Injection container (ServiceContainer).
- `src/services/pipeline`: Core conversion logic using Step pattern.
- `src/stores`: Global state using Preact Signals.
- `src/components`: UI components (Functional, Preact).

## Code Style & Conventions
- **State:** Use `@preact/signals` for global/complex state. Use `useState` only for local UI toggles.
- **Async:** Use `async/await`. Handle errors with `AppError` class.
- **Imports:** Use `@/` alias for `src/`.
- **I18n:** Use `preact-i18n` (`<Text id="..." />`).
- **Files:** Browser File System Access API is used heavily. Handle permissions carefully.
