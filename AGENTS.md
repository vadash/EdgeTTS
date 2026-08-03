# Edge TTS Web

Local-first web app that converts books to audiobooks. It uses Edge TTS for speech and LLMs for character voice assignment. Input formats are EPUB, FB2, and TXT.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test -- --run` | Unit tests |
| `npm run typecheck` | Type check only |
| `npm run check` | Format, lint, typecheck, test. Runs from the pre-commit hook |

## Boundaries

- This project runs on Windows. Use PowerShell syntax in commands. Avoid Unix-only tools and pipes.
- Never run the combined check manually. The pre-commit hook runs it. Fix reported errors and commit again.
- Never start the dev server to test a change. Verify with typecheck and unit tests, then hand the UI check to the user.
- Wrap every file system call in the permission retry helper. The browser can drop the security context at any time.
- Wrap every network and socket call in the retry helper.
- API keys must be encrypted before storage. Never write a key as plain text.

## Architecture

The conversion pipeline has four stages: split text, assign voices with an LLM, synthesize speech, merge audio.
Active conversions hold wake locks and an audio context, to stop background tab throttling.

## Documentation Map

Read the router for a directory before you edit inside it.

- `src/components/AGENTS.md` — UI components.
- `src/config/prompts/AGENTS.md` — LLM prompt definitions and schemas.
- `src/services/AGENTS.md` — Conversion pipeline.
- `src/services/llm/AGENTS.md` — LLM clients, voting, JSON parsing.
- `src/stores/AGENTS.md` — Global state.
- `src/test/AGENTS.md` — Mocks and test runners.

Deep knowledge lives in `agent_docs/`, indexed in `agent_docs/agent_docs.md`. Routers link to the matching leaf.
