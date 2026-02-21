# Plan: Codebase Entropy Reduction

Based on design: `docs/designs/2026-02-21-entropy-reduction-design.md`

## Pre-Flight Checklist

- [ ] Git status is clean
- [ ] All tests currently pass
- [ ] Design document is committed

---

## Phase 1: Delete Empty Directories (Zero Risk)

### Task 1.1: Verify no imports reference empty directories
- Run: `grep -r "from '@/di/" src/` - expect no results
- Run: `grep -r "from '@/components/about" src/` - expect no results
- Commit: N/A (verification only)

### Task 1.2: Delete empty directories
- Delete: `src/di/`
- Delete: `src/components/about/`
- Run tests to verify nothing breaks
- Commit: `refactor: remove empty di and about directories`

---

## Phase 2: Logger Consolidation

### Task 2.1: Create consolidated Logger.ts
- Create: `src/services/Logger.ts`
- Merge ILogger interface, Logger class, LoggerStore class
- Export: createLogger(), createLoggerStore()
- Do NOT delete old files yet
- Commit: `refactor: create consolidated Logger module`

### Task 2.2: Update all imports from LoggerService to Logger
- Find all files importing LoggerService
- Replace `@/services/LoggerService` with `@/services/Logger`
- Update type names: LoggerService → Logger
- Commit: `refactor: update imports to use consolidated Logger`

### Task 2.3: Update LogStore imports
- Find all files importing LogStore
- Replace `@/stores/LogStore` with `@/services/Logger`
- Update type references: LogStore → LoggerStore
- Commit: `refactor: migrate LogStore imports to Logger module`

### Task 2.4: Delete old logger files
- Delete: `src/services/LoggerService.ts`
- Delete: `src/stores/LogStore.ts`
- Run full test suite
- Commit: `refactor: remove deprecated LoggerService and LogStore files`

---

## Phase 3: Utility Consolidation

### Task 3.1: Create retry utility structure
- Create: `src/utils/retry/network.ts` - move withRetry from asyncUtils.ts
- Create: `src/utils/retry/filesystem.ts` - move withPermissionRetry from FileSystemRetry.ts
- Create: `src/utils/retry/index.ts` - re-export both functions
- Do NOT delete old files yet
- Commit: `refactor: create consolidated retry utility module`

### Task 3.2: Create file utility
- Create: `src/utils/file.ts` - move sanitizeFilename from fileUtils.ts
- Do NOT delete old file yet
- Commit: `refactor: create consolidated file utility module`

### Task 3.3: Update imports for retry utilities
- Find all files importing from asyncUtils
- Replace `@/utils/asyncUtils` with `@/utils/retry`
- Commit: `refactor: update imports to use consolidated retry module`

### Task 3.4: Update imports for FileSystemRetry
- Find all files importing FileSystemRetry
- Replace `@/services/FileSystemRetry` with `@/utils/retry`
- Commit: `refactor: update imports to use retry module for filesystem`

### Task 3.5: Update imports for fileUtils
- Find all files importing from fileUtils
- Replace `@/utils/fileUtils` with `@/utils/file`
- Commit: `refactor: update imports to use consolidated file module`

### Task 3.6: Delete old utility files
- Delete: `src/utils/asyncUtils.ts`
- Delete: `src/utils/fileUtils.ts`
- Delete: `src/services/FileSystemRetry.ts`
- Delete: `src/services/FileSystemRetry.test.ts` (will need to recreate in retry/)
- Run full test suite
- Commit: `refactor: remove deprecated utility files`

---

## Phase 4: StoreContext Simplification

### Task 4.1: Simplify useSettings hook
- Refactor to use type assertion instead of manual reconstruction
- Preserve all existing exports and types
- Commit: `refactor: simplify useSettings hook with type assertion`

### Task 4.2: Simplify useConversion hook
- Refactor to use type assertion instead of manual reconstruction
- Preserve all existing exports and types
- Commit: `refactor: simplify useConversion hook with type assertion`

### Task 4.3: Simplify useLLM hook
- Refactor to use type assertion instead of manual reconstruction
- Preserve all existing exports and types
- Commit: `refactor: simplify useLLM hook with type assertion`

### Task 4.4: Remove redundant imports
- Remove individual signal/action imports no longer needed
- Clean up the file
- Run full test suite
- Commit: `refactor: clean up StoreContext imports`

---

## Final Verification

### Task 5.1: Run full test suite
- Run: `npm test`
- Verify all tests pass
- Report final line count

### Task 5.2: Verify success metrics
- [ ] All tests passing
- [ ] 400-500 lines removed
- [ ] No breaking changes to public API
- [ ] No empty directories remaining
- [ ] Logger reduced to single file
- [ ] Utilities consolidated
- [ ] StoreContext.tsx under 200 lines
