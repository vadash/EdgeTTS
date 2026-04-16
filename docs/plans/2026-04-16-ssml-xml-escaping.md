# SSML XML Escaping Implementation Plan

**Goal:** Add XML entity escaping to the `makeSSML()` method in `ReusableEdgeTTSService.ts` to prevent permanent chunk failures from XML special characters.

**Testing Conventions:** Use Vitest with mocked external dependencies (WebSockets, network). Write failing tests first using `describe`, `expect`, `it` from vitest. Tests should verify behavior at the method level.

---

### Task 1: Create Unit Test File for ReusableEdgeTTSService

**Objective:** Establish the test infrastructure and write failing tests that verify XML entity escaping behavior in the `makeSSML()` method.

**Files to modify/create:**
- Create: `src/services/__tests__/ReusableEdgeTTSService.test.ts` (Purpose: Unit tests for ReusableEdgeTTSService, specifically the `makeSSML()` method)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/ReusableEdgeTTSService.ts` to understand the `makeSSML()` method signature and the TTSConfig interface it expects (which has `voice`, `pitch`, `rate`, `volume` properties).
2. **Write Failing Tests:** In the new test file, write tests that verify the following behaviors. Run `npm test -- --run` to ensure they fail initially:
   - **Escape all 5 XML special characters:** Test that input containing `<`, `>`, `&`, `"`, `'` produces SSML with `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`
   - **Verify escaping order:** Test that `&` is escaped first to avoid double-escaping (e.g., input `"A & B < C"` should not become `"A &amp;amp; B &lt; C"`)
   - **Normal text passes through unchanged:** Test that regular text like `"Hello world"` appears unchanged in the SSML output
   - **Already-escaped text doesn't break:** Test that input like `"&lt;tag&gt;"` becomes `"&amp;lt;tag&amp;gt;"` (redundant but still valid XML)
   - **International characters pass through:** Test that Cyrillic (`"Привет"`), Chinese (`"你好"`), and other Unicode characters are not affected by escaping
   - **Empty string handling:** Test that empty string input produces valid SSML with no text content
3. **Implementation Hint:** The `makeSSML()` method is private, so tests will need to either:
   - Use TypeScript's `as any` to access private methods for testing, OR
   - Test indirectly through the public `send()` method (but this requires more complex mocking)
4. **Verify:** Run the tests to confirm they fail with the current implementation.
5. **Commit:** Commit with message: `test: add failing tests for SSML XML escaping in makeSSML`

---

### Task 2: Implement XML Entity Escaping in makeSSML()

**Objective:** Modify the `makeSSML()` method to escape XML special characters before inserting text into the SSML envelope.

**Files to modify/create:**
- Modify: `src/services/ReusableEdgeTTSService.ts` (Purpose: Add XML entity escaping to the `makeSSML()` private method)
- Test: `src/services/__tests__/ReusableEdgeTTSService.test.ts` (Tests from Task 1 should now pass)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the current implementation of the `makeSSML()` method at lines 373-380 in `src/services/ReusableEdgeTTSService.ts`.
2. **Implement Minimal Code:** Modify the `makeSSML()` method to add XML entity escaping:
   - Create a local variable `escaped` that applies string replacements to the `text` parameter
   - **CRITICAL:** Replace `&` first (`replace(/&/g, '&amp;')`) to avoid double-escaping the ampersands in other entity replacements
   - Then replace `<` with `&lt;`
   - Then replace `>` with `&gt;`
   - Then replace `"` with `&quot;`
   - Then replace `'` with `&apos;`
   - Use this `escaped` variable in the SSML template instead of the raw `text`
3. **Verify:** Run `npm test -- --run` and ensure all tests from Task 1 now pass.
4. **Commit:** Commit with message: `feat: escape XML entities in makeSSML to prevent malformed SSML errors`

---

### Task 3: Integration Test with Full Pipeline

**Objective:** Verify that chunks containing XML special characters now successfully complete TTS conversion without permanent failures.

**Files to modify/create:**
- Create: `src/services/__tests__/ReusableEdgeTTSService.integration.test.ts` (Purpose: Integration test that sends problematic text through the full TTS pipeline)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outlines of `src/services/TTSWorkerPool.ts` and `src/services/ReusableEdgeTTSService.ts` to understand how text flows through the pipeline. Note that integration tests should mock WebSockets per `src/test/CLAUDE.md` guidelines.
2. **Write Integration Test:** Create an integration test that:
   - Sets up a mocked ReusableEdgeTTSService with a mock WebSocket
   - Sends test data containing known problematic characters: `"5 < 10 and 20 > 15"`, `"AT&T is a company"`, `"O'Connor's book"`
   - Verifies that the SSML sent to the WebSocket contains properly escaped entities
   - Verifies that no `RetriableError` is thrown due to malformed XML
3. **Verify:** Run the integration test to ensure it passes.
4. **Commit:** Commit with message: `test: add integration test for XML escaping in full TTS pipeline`

---

### Task 4: Manual Verification (Optional but Recommended)

**Objective:** Run a real-world conversion with a book containing XML special characters to confirm the fix works in production.

**Files to modify/create:**
- None (manual testing step)

**Instructions for Execution Agent:**
This task is for manual verification by the user. The implementation agent should skip this task. Instructions for the user:
1. Load a book (EPUB/TXT) known to contain XML special characters like `&`, `<`, `>`, quotes, or apostrophes
2. Run a conversion
3. Monitor that no chunks permanently fail
4. Check `logs/tts_fail*.json` to ensure no XML-related errors
5. If clean, the implementation is complete

---

## Task Dependencies

- **Task 2 depends on Task 1:** The implementation in Task 2 should make the failing tests from Task 1 pass.
- **Task 3 depends on Task 2:** Integration test requires the XML escaping implementation to be in place.
- **Task 4 is independent:** Manual verification can happen at any time after Task 2 is complete.
