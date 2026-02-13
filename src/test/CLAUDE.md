# Testing Guidelines

## Stack
- **Runner:** Vitest.
- **Mocks:** `vi.fn()` and manual mocks in `src/test/mocks`.

## Patterns
- **Service Tests:** Use `createTestContainer` (`src/test/TestServiceContainer.ts`) to inject mocks.
- **Component Tests:** Use `renderWithProviders` (`src/test/utils.tsx`) to wrap components with Store/DI context.
- **Factories:** Use factories in `src/test/factories` for creating complex objects (Characters, Assignments).

## Rules
- **Network:** Never make real network calls in `*.test.ts`. Mock `fetch` or the Service layer.
- **Real Tests:** Real LLM API tests go in `src/test/llm-real.test.ts` (excluded from standard run).
- **File System:** Use `createMockDirectoryHandle` helper for File System API tests.