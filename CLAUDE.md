# Edge TTS Web

**WHAT**: A local-first Text-to-Speech web app that converts books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs for character voice assignment.
**WHY**: To provide a free, high-quality audiobook generation pipeline optimized for LitRPG, Web Novels, and multi-character stories.
**HOW**: Built with TypeScript, Preact, Tailwind CSS, `@preact/signals`, and Webpack. Runs entirely in the browser (uses FFmpeg.wasm for audio processing and File System Access API for local file management).

## Core Commands
- `npm run dev`: Start Webpack dev server
- `npm run build`: Production build
- `npm test`: Run unit tests (Vitest)
- `npm run test:real`: Run integration tests against real LLM APIs

## Architecture Map (Progressive Disclosure)
Claude, if you are working in specific domains, rely on the local `CLAUDE.md` files in those directories:
- `src/services/` - Core processing pipeline (Orchestrator, TTS Workers, FFmpeg).
- `src/services/llm/` - LLM interaction, prompting, and parsing logic.
- `src/stores/` - Global state management with `@preact/signals`.
- `src/test/` - Testing conventions (mocked vs real API tests).

## Global Gotchas
- **File System**: The app writes directly to the user's hard drive to prevent OOM errors. All file operations MUST use `withPermissionRetry` to handle browser security drops.
- **Async Resilience**: Network and WebSocket calls must use the internal `withRetry` utility (which wraps `p-retry`) to survive sleep modes and rate limits.
