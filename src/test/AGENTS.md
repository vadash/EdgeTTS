# Testing Guidelines

Vitest test suites.

## Commands

| Command | Description |
|---------|-------------|
| `npm test -- --run` | Standard unit tests |
| `npm run test:watch` | Watch mode |
| `npm run test:real` | Real LLM integration tests |
| `npm run test:real:qa` | Real tests with the Assign QA pass on |
| `npm run test:real:repeat` | Real tests with prompt repetition on |

## Rules

- Unit tests must mock the network, the file system API, and sockets.
- The retry, queue, and pool libraries are mocked globally to run without delay.
- The IndexedDB mock must fire its success callback asynchronously, or promises hang.
- Real LLM tests need a local config file with real API keys. Copy the example file.
- Clear local storage before each test.
- Parameterized tests expand one source entry into many runtime tests. Trust the runner summary for counts, not a text search.
