# Testing Guidelines

Vitest-based test suites covering utilities, services, and prompt behavior.

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run standard unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:real` | Run integration tests against real LLM APIs |
| `npm run test:real:qa` | Run integration tests with Assign QA Pass enabled |
| `npm run test:real:repeat` | Run integration tests with Prompt Repetition enabled |

## Test Categories

### 1. Standard Unit Tests (`*.test.ts`)
- Run via `npm test`.
- Fast and deterministic.
- **Key test files:**
  - `CharacterUtils.test.ts` - Frequency culling logic (`cullByFrequency`)
  - `TextBlockSplitter.test.ts` - Semantic chunking (scene breaks, dividers, chapter headers)
  - `PromptStrategy.test.ts` - Overlap context injection with negative indices

### 2. Real LLM Tests (`llm-real.test.ts`)
- Run via `npm run test:real` (or its `qa`/`repeat` permutations).
- Uses `vitest.real.config.ts` (has an extended 5-minute timeout).
- These make ACTUAL network calls to OpenAI/etc.
- Use text files in `src/test/fixtures/` and define fixtures in `src/test/fixtures/index.ts` to validate character extraction and dialogue assignment accuracy.

## Gotchas

- **Mocking**: Standard unit tests MUST mock all external network calls, File System API (`createMockDirectoryHandle`), and WebSockets. Check `src/test/setup.ts` and `src/test/mocks/` for existing mock infrastructure.
- **API Keys**: Real LLM tests require populating `test.config.local.ts` (copy from `.example`) with actual API credentials. Do not commit this file.
- **Environment Variables**: The `test:real:qa` and `test:real:repeat` scripts use `cross-env` to temporarily inject `USE_QA=true` or `REPEAT_PROMPT=true` during the test run, overriding `test.config.local.ts` defaults.
