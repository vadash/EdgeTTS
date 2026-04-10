# Testing Guidelines

Vitest-based test suites covering utilities, services, state logic, and prompt behavior.

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run standard unit tests (`vitest.config.ts`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report (V8 engine) |
| `npm run test:real` | Run integration tests against real LLM APIs |
| `npm run test:real:qa` | Run integration tests with Assign QA Pass enabled |
| `npm run test:real:repeat` | Run integration tests with Prompt Repetition enabled |
| `npm run test:real:repeat:qa`| Run integration tests with Repetition AND QA Pass enabled |

## Test Categories

### 1. Standard Unit Tests (`*.test.ts`)
- Run via `npm test`. Fast, deterministic, isolated (uses JSdom environment).
- **Key test files:**
  - `CharacterUtils.test.ts` - Frequency culling logic (`cullByFrequency`).
  - `schemas.test.ts` - Schema strictness (extra keys safely ignored).
  - `text.test.ts` - JSON repair pipeline (array-at-root recovery, flattened assignments, tag stripping).
  - `TextBlockSplitter.test.ts` - Semantic chunking (scene breaks, dividers, chapter headers).
  - `ChunkStore.integration.test.ts` - Validates out-of-order writes and disk recovery.

### 2. Real LLM Tests (`llm-real.test.ts`)
- Run via `npm run test:real` (or its `qa`/`repeat` permutations).
- Uses `vitest.real.config.ts` (has an extended 5-minute timeout and Node environment).
- These make ACTUAL network calls to OpenAI/Mistral/etc.
- Use text files in `src/test/fixtures/` and define fixtures in `src/test/fixtures/index.ts` to validate character extraction and dialogue assignment accuracy.

## Gotchas

- **Mocking Strategy**: Standard unit tests MUST mock all external network calls, File System API (`createMockDirectoryHandle`), and WebSockets.
- **Global Mocks**: `p-retry`, `p-queue`, and `generic-pool` are mocked globally in `src/test/setup.ts` to execute immediately without actual polling/delays.
- **API Keys for Real Tests**: Real LLM tests require populating `test.config.local.ts` (copy from `.example`) with actual API credentials. Do not commit this file.
- **Environment Variables**: The `test:real:*` scripts use `cross-env` to temporarily inject `USE_QA=true` or `REPEAT_PROMPT=true` during the test run, overriding `test.config.local.ts` defaults.
