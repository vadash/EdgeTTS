# Edge TTS Web

A local-first Text-to-Speech web app that converts books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs for character voice assignment.

## Architecture Map

```text
src/
  components/   # UI: Preact + Tailwind CSS (see components/CLAUDE.md)
  config/       # App config and LLM Prompts (see config/prompts/CLAUDE.md)
  services/     # Core pipeline: Orchestrator, TTS, FFmpeg (see services/CLAUDE.md)
  stores/       # Global state: @preact/signals (see stores/CLAUDE.md)
  test/         # Testing conventions & mocks (see test/CLAUDE.md)
  utils/        # Shared helpers (text repair, language detection)
```

## Tech Stack & Libraries

- **UI:** Preact + Tailwind CSS
- **State:** `@preact/signals`
- **Audio:** `@ffmpeg/ffmpeg` (WASM, bundled locally)
- **LLM:** `openai` SDK + Zod 4 (Strict Structured Outputs via `toJSONSchema`)
- **Resilience:** `p-retry` wrapped in `withRetry` utilities
- **Files:** `jszip`, DOMParser (EPUB/FB2 extraction)

## Key Design Decisions

- **Memory:** Never hold audio in RAM. Write chunks to disk via File System Access API to prevent browser OOM.
- **Structured Outputs:** LLM responses use Zod schemas (non-strict, extra keys ignored). Pass through `safeParseJSON()` (in `src/utils/text.ts`) which handles markdown fences, thinking tags, `jsonrepair`, and structural recovery (naked arrays, flattened assignments).
- **QA Pass (Assign):** When enabled (`useVoting`), Assign runs a sequential draft -> QA correction pass (2 API calls). QA catches vocative traps, missed action beats, and narration errors.
- **Consensus Voting (Merge):** Merge stage uses 5-way voting with random temperatures and Union-Find consensus.
- **Semantic Chunking:** `TextBlockSplitter` prefers natural scene boundaries (dividers, chapter headers, long narration passages) over arbitrary token-limit cuts.
- **Frequency Culling:** Characters with fewer than 3 name mentions are filtered before the LLM merge step to reduce hallucinations.

## Gotchas

- **File System**: The app writes directly to the user's hard drive to prevent OOM errors. All file operations MUST use `withPermissionRetry` to handle browser security drops.
- **Async Resilience**: Network and WebSocket calls must use the internal `withRetry` utility (which wraps `p-retry`) to survive sleep modes and rate limits.
