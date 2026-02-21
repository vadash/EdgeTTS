# Testing Guidelines

**WHAT**: Vitest-based test suites.

## Test Categories
1. **Standard Unit Tests** (`*.test.ts`)
   - Run via `npm test`.
   - MUST mock all external network calls, File System API (`createMockDirectoryHandle`), and WebSockets.
   - Fast and deterministic.

2. **Real LLM Tests** (`llm-real.test.ts`)
   - Run via `npm run test:real`.
   - Uses `vitest.real.config.ts`.
   - These make ACTUAL network calls to OpenAI/etc. Do not include these in standard test runs to save money/tokens.
   - Use text files in `src/test/fixtures/` to validate character extraction and dialogue assignment accuracy.
   