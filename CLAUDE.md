# Edge TTS Web

**WHAT**: A local-first Text-to-Speech web app that converts books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs for character voice assignment.
**WHY**: To provide a free, high-quality audiobook generation pipeline optimized for LitRPG, Web Novels, and multi-character stories.
**HOW**: Built with TypeScript, Preact, Tailwind CSS, `@preact/signals`, and Webpack. Runs entirely in the browser (uses FFmpeg.wasm for audio processing and File System Access API for local file management).

## Tech Stack & Libraries
- **UI:** Preact + Tailwind CSS
- **State:** `@preact/signals` (global singletons in `/src/stores`)
- **Audio:** `@ffmpeg/ffmpeg` (WASM, bundled locally via CopyWebpackPlugin)
- **LLM:** `openai` SDK + Zod 4 (Strict Structured Outputs via `toJSONSchema`)
- **Resilience:** `p-retry` wrapped in `withRetry` utilities
- **Files:** `jszip`, DOMParser (EPUB/FB2 extraction)

## Key Design Decisions
- **Memory:** Never hold audio in RAM. Write chunks to disk via File System Access API to prevent browser OOM.
- **Structured Outputs:** LLM responses use Zod schemas with `.strict()` mode. Pass through `safeParseJSON()` (in `src/utils/text.ts`) which handles markdown fences, thinking tags, and `jsonrepair`.
- **Prompt Examples:** Few-shot examples use `output` field only (JSON with embedded `reasoning`). The separate `thinking` property was removed — reasoning now lives inside the JSON output only.
- **Consensus Voting:** Assign stage uses 3-way voting at [0.3, 0.7, 1.0] temperatures; Merge uses 5-way with random temps.
- **Semantic Chunking:** `TextBlockSplitter` prefers natural scene boundaries (dividers like `***`, chapter headers, long narration passages) over arbitrary token-limit cuts.
- **Frequency Culling:** Characters with fewer than 3 name mentions are filtered before the LLM merge step to reduce hallucinations.
- **Overlap Context:** Assign stage passes the last 5 sentences from the previous block as read-only context with negative indices `[-5]` through `[-1]` to improve speaker continuity.

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
