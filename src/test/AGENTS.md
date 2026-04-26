# Testing Guidelines

Vitest-based test suites.

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run standard unit tests (`vitest.config.ts`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:real` | Run real LLM integration tests |
| `npm run test:real:qa` | Real tests + Assign QA Pass enabled |
| `npm run test:real:repeat` | Real tests + Prompt Repetition enabled |

## Gotchas

- **Mocking**: Standard tests MUST mock external network, File System API (`createMockDirectoryHandle`), and WebSockets.
- **Globals**: `p-retry`, `p-queue`, and `generic-pool` are mocked globally in `src/test/setup.ts` to execute immediately.
- **IndexedDB**: The `window.indexedDB` mock requires `onsuccess` to be fired asynchronously via `queueMicrotask` to prevent hanging promises.
- **Real LLM Tests**: Require `test.config.local.ts` populated with real API keys (copy from `.example`).
- **Local Storage**: Always call `localStorage.clear()` in `beforeEach()`.
