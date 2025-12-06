  Files:
  - src/test/fixtures/index.ts - fixture definitions (add new tests here)
  - src/test/fixtures/XXX.txt - test text file
  - src/test/llm-test-helpers.ts - reusable helpers
  - src/test/llm-real.test.ts - data-driven test runner

  To add a new test:
  1. Drop text file in src/test/fixtures/
  2. Add entry to fixtures array in src/test/fixtures/index.ts:
  {
    name: 'My Test',
    file: 'my-test.txt',
    expectedCharacters: [
      { name: 'john', gender: 'male' },
    ],
    expectedDialogueLines: [
      { textContains: 'Hello world', speaker: 'john', strict: false },
    ],
  }

  Output shows:
  - ✓ passed attribution
  - ✗ wrong attribution
  - ❓ text not found

  Set strict: true to fail tests on mismatch.