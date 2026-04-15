# Edge TTS Web

A local-first Text-to-Speech web app that converts books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs for character voice assignment.

### Pre-Commit
- **Never run `npm run check` manually** — it runs automatically on every commit. If it fails, fix the errors and commit again.

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

- **Memory/Disk Management:** Never hold audio in RAM. See `services/CLAUDE.md`
- **Prompt Engineering:** Chain-of-Draft (CoD) shorthand. See `src/config/prompts/CLAUDE.md`
- **Structured Outputs:** Zod 4 schemas + `safeParseJSON()` repair pipeline. See `src/services/llm/CLAUDE.md`
- **QA Pass (Assign):** When enabled (`useVoting`), Assign runs a sequential draft -> QA correction pass
- **Consensus Voting (Merge):** 5-way voting with random temperatures and Union-Find consensus
- **Semantic Chunking:** Natural scene boundaries preferred. See `services/CLAUDE.md`
- **Frequency Culling:** Characters with < 3 mentions filtered pre-merge

## Gotchas

- **File System API**: The app writes directly to the user's hard drive to prevent OOM errors. All file operations MUST use `withPermissionRetry` to gracefully handle browser security context drops.
- **Async Resilience**: Network and WebSocket calls must use the internal `withRetry` utility (which wraps `p-retry`) to survive sleep modes and rate limits.
- **KeepAwake Strategy**: The app uses `AudioContext` dummy oscillators, Web Locks API, and Screen Wake Lock to prevent background tab throttling during long conversions.
