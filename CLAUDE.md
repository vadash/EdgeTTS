# Edge TTS Web

A local-first Text-to-Speech web app that converts books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs for character voice assignment.

### Pre-Commit
- **`npm run check` runs automatically on every commit** (format, lint, typecheck, test). The commit is aborted on any failure — fix errors, never skip them

## Architecture Map

```text
src/
  components/   # UI: Preact + Tailwind CSS (see components/CLAUDE.md)
  config/       # App config and LLM Prompts (see config/prompts/CLAUDE.md)
  errors/       # Typed error codes and AppError class
  hooks/        # Shared Preact hooks (`useTTSConversion`, `useVoicePreview`)
  router/       # Custom hash-based router
  services/     # Core pipeline: Orchestrator, TTS, FFmpeg (see services/CLAUDE.md)
  stores/       # Global state: @preact/signals (see stores/CLAUDE.md)
  test/         # Testing conventions & mocks (see test/CLAUDE.md)
  utils/        # Shared helpers (text repair, language detection, retry)
```

## Tech Stack & Libraries

- **UI:** Preact + Tailwind CSS v4
- **State:** `@preact/signals`
- **Build:** Webpack + TypeScript
- **Audio:** `@ffmpeg/ffmpeg` (WASM, bundled locally)
- **LLM:** `openai` SDK + Zod 4 (Strict Structured Outputs via `toJSONSchema`)
- **Resilience:** `p-retry` wrapped in `withRetry` utilities, `p-queue` for concurrency
- **Files:** `jszip`, DOMParser (EPUB/FB2 extraction)

## Key Design Decisions

- **Memory/Disk Management:** Never hold audio in RAM. `TTSWorkerPool` writes chunks to disk immediately via `ChunkStore`. `AudioMerger` reads them sequentially.
- **Structured Outputs:** LLM responses use Zod 4 schemas (non-strict). Pass through `safeParseJSON()` (in `src/utils/text.ts`) which handles markdown fences, tag stripping, `jsonrepair`, and structural recovery (naked arrays, flattened assignments).
- **QA Pass (Assign):** When enabled (`useVoting`), Assign runs a sequential draft -> QA correction pass. QA catches vocative traps, missed action beats, and narration errors.
- **Consensus Voting (Merge):** Merge stage uses 5-way voting with random temperatures and Union-Find consensus.
- **Semantic Chunking:** `TextBlockSplitter` prefers natural scene boundaries (dividers, chapter headers, long narration passages) over arbitrary token-limit cuts.
- **Frequency Culling:** Characters with < 3 name mentions are filtered before the LLM merge step to reduce hallucinations and API costs.

## Gotchas

- **File System API**: The app writes directly to the user's hard drive to prevent OOM errors. All file operations MUST use `withPermissionRetry` to gracefully handle browser security context drops.
- **Async Resilience**: Network and WebSocket calls must use the internal `withRetry` utility (which wraps `p-retry`) to survive sleep modes and rate limits.
- **KeepAwake Strategy**: The app uses `AudioContext` dummy oscillators, Web Locks API, and Screen Wake Lock to prevent background tab throttling during long conversions.
