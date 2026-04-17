# Design: Codebase Entropy Reduction

## 1. Problem Statement

The EdgeTTS codebase has accumulated entropy through:
- **Empty directories** that create confusion (`src/di/`, `src/components/about/`)
- **Triple-redundant export patterns** in StoreContext.tsx (400 lines exporting as modules, individual exports, AND typed hooks)
- **Duplicate logger implementations** (LoggerService.ts + LogStore.ts both implementing ILogger)
- **Oversplit utility files** (asyncUtils.ts with 1 function, fileUtils.ts with 1 function, FileSystemRetry.ts with 1 function)
- **Container-managed singleton pattern** that adds complexity without clear benefit

Current state: ~21,500 lines across 147 source files. Potential reduction: ~500-600 lines.

## 2. Goals & Non-Goals

### Must Do
- Delete empty directories
- Consolidate duplicate logger implementations
- Merge oversplit utilities into cohesive modules
- Simplify StoreContext.tsx exports
- Reduce total line count by 400-500 lines
- Maintain all existing functionality
- Pass all tests

### Won't Do
- Change the public API of hooks (useSettings, useConversion, useLLM)
- Modify the signal-based store architecture
- Remove the ILogger interface (needed for DI/test mocks)
- Change FFmpegService's singleton management (working as intended)

## 3. Proposed Architecture

### 3.1 Logger Consolidation

**Current State:**
- `LoggerService.ts` (115 lines) - Adds prefix, delegates to LogStore
- `LogStore.ts` (179 lines) - Implements ILogger, stores entries
- Both implement `ILogger` interface

**Proposed State:**
- Merge into single `Logger.ts` file
- `Logger` class implements `ILogger`
- `LoggerStore` extends `Logger` with storage and UI features
- Remove `LoggerService.ts` entirely
- ~200 lines total (down from 294)

```typescript
// src/services/Logger.ts
export interface ILogger { ... }
export class Logger implements ILogger { ... }
export class LoggerStore extends Logger implements ILogger { ... }
export function createLogger(...): Logger { ... }
export function createLoggerStore(...): LoggerStore { ... }
```

### 3.2 Utility Consolidation

**Current State:**
- `asyncUtils.ts` (67 lines) - Only exports `withRetry`
- `fileUtils.ts` (30 lines) - Only exports `sanitizeFilename`
- `FileSystemRetry.ts` (31 lines) - Only exports `withPermissionRetry`

**Proposed State:**
- Create `src/utils/retry.ts` with both retry functions
- Move `sanitizeFilename` to `src/utils/file.ts`
- Delete the three oversplit files
- ~80 lines total (down from 128)

```typescript
// src/utils/retry.ts
export { withRetry } from './retry/network';
export { withPermissionRetry } from './retry/filesystem';

// src/utils/file.ts
export { sanitizeFilename } from './file/sanitize';
```

### 3.3 StoreContext Simplification

**Current State:**
- Exports modules (SettingsStore, ConversionStore, LLMStore)
- Re-exports individual signals and actions
- Creates typed hooks that manually reconstruct the exports
- Triple redundancy = ~300 lines of duplication

**Proposed State:**
- Keep module exports (base layer)
- Keep individual exports for backward compatibility
- Simplify hooks to re-export from store modules directly
- Use type assertion for hook return values instead of manual reconstruction
- ~150 lines (down from 400)

```typescript
// Before: Manual reconstruction in each hook
export function useSettings() {
  return {
    value: settingsSignal,
    voice, narratorVoice, // ... 30+ lines of manual mapping
    setVoice, setNarratorVoice, // ... another 30+ lines
  };
}

// After: Direct re-export
export function useSettings() {
  return SettingsStore as unknown as SettingsStore & LegacyMethods;
}
```

### 3.4 Directory Cleanup

**Delete Immediately:**
- `src/di/` - Empty directory
- `src/components/about/` - Empty directory (functionality in `components/info/`)

### 3.5 Singleton Pattern

**Finding:** The comment in FFmpegService.ts says "Container-managed singleton (no static getInstance)" but there is NO actual DI container. The "container" is the `createStores()` factory function in StoreContext.tsx.

**Decision:** The current approach is fine. The factory pattern in `createStores()` IS the simple DI container. No changes needed.

## 4. Data Models / Schema

No data model changes - purely refactoring.

## 5. Interface / API Design

### 5.1 Logger (Consolidated)

```typescript
// src/services/Logger.ts

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  elapsed: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface ILogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
  debug?(message: string, data?: Record<string, unknown>): void;
}

export class Logger implements ILogger {
  constructor(private store: ILogger | null = null, private prefix: string = '') {}

  info(message: string, data?: Record<string, unknown>): void {
    const formatted = this.prefix ? `[${this.prefix}] ${message}` : message;
    console.log(`[INFO] ${formatted}`, data ?? '');
    this.store?.info(formatted, data);
  }
  // ... warn, error, debug, child()
}

export class LoggerStore extends Logger implements ILogger {
  readonly entries = signal<LogEntry[]>([]);
  readonly maxEntries = signal<number>(2000);
  readonly startTime = signal<number | null>(null);

  add(level: LogLevel, message: string, data?: Record<string, unknown>): void { ... }
  // ... storage methods
}
```

### 5.2 Retry Utilities (Consolidated)

```typescript
// src/utils/retry/network.ts
export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: unknown, nextDelay: number) => void;
  shouldRetry?: (error: unknown) => boolean;
  signal?: AbortSignal;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T>;

// src/utils/retry/filesystem.ts
export async function withPermissionRetry<T>(
  directoryHandle: FileSystemDirectoryHandle,
  operation: () => Promise<T>,
  notify?: (message: string) => void
): Promise<T>;
```

## 6. Risks & Edge Cases

### 6.1 Import Breaking Changes

**Risk:** Code importing from old file paths will break.
**Mitigation:** Search and replace all imports before deleting files.

**Files to update:**
- `LoggerService` → `Logger`
- `asyncUtils` → `retry`
- `fileUtils` → `file`

### 6.2 Hook Return Type Compatibility

**Risk:** Simplifying `useSettings()` might break type assertions in components.
**Mitigation:** Use `unknown` cast to preserve existing type signatures while reducing duplication.

### 6.3 Test Dependencies

**Risk:** Tests may import from deleted files.
**Mitigation:** Run full test suite after each consolidation step.

## 7. Migration Plan

### Phase 1: Delete Empty Directories (Zero Risk)
1. Delete `src/di/`
2. Delete `src/components/about/`
3. Verify no imports reference these paths
4. Run tests

### Phase 2: Logger Consolidation
1. Create `src/services/Logger.ts` with merged code
2. Update all imports from `LoggerService` to `Logger`
3. Delete `LoggerService.ts`
4. Run tests

### Phase 3: Utility Consolidation
1. Create `src/utils/retry/` directory structure
2. Move `withRetry` to `retry/network.ts`
3. Move `withPermissionRetry` to `retry/filesystem.ts`
4. Create `retry/index.ts` re-exports
5. Move `sanitizeFilename` to `file.ts`
6. Update all imports
7. Delete old files
8. Run tests

### Phase 4: StoreContext Simplification
1. Refactor hooks to use type assertions
2. Verify no component breaks
3. Run tests

## 8. Success Metrics

- [ ] All tests passing
- [ ] 400-500 lines removed
- [ ] No breaking changes to public API
- [ ] No empty directories remaining
- [ ] Logger reduced to single file
- [ ] Utilities consolidated
- [ ] StoreContext.tsx under 200 lines

## 9. Rollback Plan

Each phase can be reverted independently via git:
- Phase 1: `git checkout HEAD~1 -- src/di/ src/components/about/`
- Phase 2: `git checkout HEAD~1 -- src/services/LoggerService.ts`
- Phase 3: `git checkout HEAD~1 -- src/utils/`
- Phase 4: `git checkout HEAD~1 -- src/stores/StoreContext.tsx`
