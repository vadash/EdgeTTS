# Edge TTS Web

Local-first TTS web app converting books (EPUB/FB2/TXT) to audiobooks using Edge TTS and LLMs.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (webpack) |
| `npm run build` | Production build |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | format + lint + typecheck + test (runs via pre-commit hook) |

Real LLM integration test variants are documented in `src/test/AGENTS.md`.

## Documentation Map

Each major directory has its own `AGENTS.md` — read it before editing there:

- `src/components/` - Preact + Tailwind UI
- `src/config/prompts/` - LLM Prompt definitions & schemas
- `src/services/` - Core conversion pipeline (Split -> LLM -> TTS -> Merge)
- `src/services/llm/` - LLM API clients, voting, and JSON repair
- `src/stores/` - Global state via `@preact/signals`
- `src/test/` - Mocks and test runners

Deep-dive knowledge lives in `agent_docs/` (indexed in `agent_docs/README.md`); nested routers link to the relevant leaf.

## Gotchas

- **PowerShell Compatibility**: This project runs on Windows. Avoid Unix-specific commands in Execute tool calls:
  - Don't use: `tail`, `head`, `grep`, `find`, `|` (piping), `&&`, `||`, `$(...)`, backticks
  - Use PowerShell equivalents: `Get-Content`, `Select-String`, `;` for chaining
  - For npm scripts, prefer direct execution: `npm test -- --run` instead of `npm test -- --run 2>&1 | tail -50`
- **Pre-Commit**: Never run `npm run check` manually (runs automatically via hooks). If it fails, fix errors and commit again.
- **Filesystem API**: App writes directly to disk to prevent OOM. Use `withPermissionRetry` for ALL file operations to handle security context drops.
- **Async Resilience**: Always use `withRetry` (which wraps `p-retry`) for network/WebSocket calls.
- **KeepAwake**: Active conversions use AudioContext, Web Locks, and Screen Wake Lock to prevent background tab throttling.
