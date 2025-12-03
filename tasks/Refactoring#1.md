# EdgeTTS Refactoring Plan

## Goals
- Easier extension and maintenance
- Cleaner pipeline with proper separation of concerns
- Full state management redesign
- Better UI and structured logging
- Vitest-ready architecture (interfaces, DI, no global state)

## Constraints
- LLM mode remains required (simplify around this)
- 2 i18n locales (en, ru)
- Foundation-first approach

---

## Phase 1: Core Architecture

### 1.1 Service Layer Interfaces
Create interfaces for all services to enable mocking and testing.

**New file: `src/services/interfaces.ts`**
```typescript
interface ITTSService {
  convert(text: string, voice: string, config: TTSConfig): Promise<Uint8Array>;
}

interface IWorkerPool {
  addTask(task: PoolTask): void;
  start(): void;
  stop(): void;
  onComplete: (callback: CompleteCallback) => void;
}

interface IAudioMerger {
  merge(audioMap: Map<number, Uint8Array>, config: MergeConfig): Promise<MergedFile[]>;
}

interface ILLMService {
  extractCharacters(blocks: TextBlock[]): Promise<LLMCharacter[]>;
  assignSpeakers(blocks: TextBlock[], characterMap: Map<string, string>): Promise<SpeakerAssignment[]>;
}

interface IFFmpegService {
  load(): Promise<boolean>;
  processAudio(data: Uint8Array, options: ProcessOptions): Promise<Uint8Array>;
  isAvailable(): boolean;
}

interface ILogger {
  info(message: string, data?: object): void;
  warn(message: string, data?: object): void;
  error(message: string, error?: Error): void;
}
```

### 1.2 Dependency Injection Container
Create a simple DI container using Preact Context.

**New file: `src/di/ServiceContainer.ts`**
```typescript
interface ServiceContainer {
  ttsService: ITTSService;
  workerPool: IWorkerPool;
  audioMerger: IAudioMerger;
  llmService: ILLMService;
  ffmpegService: IFFmpegService;
  logger: ILogger;
  config: AppConfig;
}
```

**New file: `src/di/ServiceContext.tsx`**
- Preact Context provider for services
- Factory function to create real services
- Test utilities to inject mocks

### 1.3 Configuration Extraction
Move all magic numbers to configuration.

**New file: `src/config/index.ts`**
```typescript
interface AppConfig {
  tts: {
    maxWorkers: number;
    retryDelays: number[];
    maxRetries: number;
    errorCooldown: number;
  };
  audio: {
    targetMergeDurationMs: number;
    bytesPerMs: number;
    opusBitrate: number;
  };
  llm: {
    pass1BlockSize: number;
    pass2BlockSize: number;
    maxConcurrentRequests: number;
    retryDelays: number[];
  };
  ffmpeg: {
    cdnUrls: string[];
    silenceThreshold: string;
    loudnessTarget: number;
  };
}
```

---

## Phase 2: State Management Redesign

### 2.1 Domain State Stores
Replace 40+ global signals with domain-focused stores.

**New directory: `src/stores/`**

**`src/stores/SettingsStore.ts`**
```typescript
class SettingsStore {
  private state = signal<Settings>({...});

  // Getters
  get voice() { return this.state.value.voice; }
  get rate() { return this.state.value.rate; }

  // Actions
  setVoice(voice: string): void;
  setRate(rate: number): void;
  save(): void;
  load(): void;
  reset(): void;
}
```

**`src/stores/ConversionStore.ts`**
```typescript
class ConversionStore {
  private state = signal<ConversionState>({
    status: 'idle' | 'llm-pass1' | 'llm-pass2' | 'converting' | 'merging' | 'complete' | 'error',
    progress: { current: 0, total: 0 },
    startTime: null,
    error: null,
  });

  // Actions
  startConversion(): void;
  updateProgress(current: number, total: number): void;
  setError(error: AppError): void;
  reset(): void;
}
```

**`src/stores/LLMStore.ts`**
```typescript
class LLMStore {
  private state = signal<LLMState>({
    characters: [],
    voiceMap: new Map(),
    currentBlock: 0,
    totalBlocks: 0,
  });

  // Actions
  setCharacters(chars: LLMCharacter[]): void;
  updateVoiceMap(map: Map<string, string>): void;
}
```

**`src/stores/LogStore.ts`**
```typescript
interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: object;
}

class LogStore {
  private entries = signal<LogEntry[]>([]);
  private maxEntries = 500;

  add(entry: LogEntry): void;
  clear(): void;
  getByLevel(level: string): LogEntry[];
}
```

### 2.2 Store Provider
**New file: `src/stores/StoreContext.tsx`**
```typescript
interface Stores {
  settings: SettingsStore;
  conversion: ConversionStore;
  llm: LLMStore;
  logs: LogStore;
}

// Context + Provider for component access
// Hook: useStore<T>(selector: (stores: Stores) => T)
```

---

## Phase 3: Pipeline Refactoring

### 3.1 Conversion Orchestrator
Extract conversion logic from hook into testable class.

**New file: `src/services/ConversionOrchestrator.ts`**
```typescript
class ConversionOrchestrator {
  constructor(
    private services: ServiceContainer,
    private stores: Stores
  ) {}

  async run(text: string, settings: Settings): Promise<void> {
    // Step 1: LLM Pass 1 - Character extraction
    await this.runLLMPass1(text);

    // Step 2: Voice assignment
    await this.assignVoices();

    // Step 3: LLM Pass 2 - Speaker assignment
    const assignments = await this.runLLMPass2(text);

    // Step 4: TTS conversion
    const audioMap = await this.runTTSConversion(assignments);

    // Step 5: Audio merge & save
    await this.mergeAndSave(audioMap);
  }

  cancel(): void;
}
```

### 3.2 Simplified useTTSConversion Hook
**Refactored: `src/hooks/useTTSConversion.ts`**
```typescript
function useTTSConversion() {
  const services = useServices();
  const stores = useStores();
  const orchestrator = useMemo(
    () => new ConversionOrchestrator(services, stores),
    [services, stores]
  );

  const start = useCallback(async () => {
    try {
      await orchestrator.run(stores.settings.textContent, stores.settings.current);
    } catch (error) {
      stores.logs.add({ level: 'error', message: error.message });
    }
  }, [orchestrator, stores]);

  return { start, cancel: orchestrator.cancel };
}
```

---

## Phase 4: Error Handling & Logging

### 4.1 Structured Errors
**New file: `src/errors/index.ts`**
```typescript
class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public cause?: Error
  ) { super(message); }
}

type ErrorCode =
  | 'TTS_WEBSOCKET_FAILED'
  | 'TTS_TIMEOUT'
  | 'LLM_API_ERROR'
  | 'LLM_VALIDATION_ERROR'
  | 'FFMPEG_LOAD_FAILED'
  | 'FILE_SYSTEM_ERROR';
```

### 4.2 Retry Strategy
**New file: `src/utils/RetryStrategy.ts`**
```typescript
interface RetryStrategy {
  shouldRetry(error: AppError, attempt: number): boolean;
  getDelay(attempt: number): number;
}

class ExponentialBackoffStrategy implements RetryStrategy {
  constructor(
    private maxAttempts: number,
    private baseDelay: number,
    private maxDelay: number
  ) {}
}

// Utility function
async function withRetry<T>(
  fn: () => Promise<T>,
  strategy: RetryStrategy,
  logger: ILogger
): Promise<T>;
```

### 4.3 Logger Service
**New file: `src/services/LoggerService.ts`**
```typescript
class LoggerService implements ILogger {
  constructor(private store: LogStore) {}

  info(message: string, data?: object): void {
    console.log(message, data);
    this.store.add({ level: 'info', timestamp: new Date(), message, data });
  }

  warn(message: string, data?: object): void { /* ... */ }
  error(message: string, error?: Error): void { /* ... */ }
}
```

---

## Phase 5: UI Improvements

### 5.1 StatusArea Enhancement
**Refactored: `src/components/StatusArea.tsx`**
- Auto-scroll to bottom on new entries
- Color-coded log levels (info=default, warn=yellow, error=red)
- Progress bar with percentage and ETA
- Clear logs button
- Copy logs button

### 5.2 Extract Inline Styles
**New file: `src/styles/components.css`**
- Move all inline styles from LLMSettingsPanel, StatusArea, etc.
- Use CSS custom properties for theming

### 5.3 Component Cleanup
- Add proper TypeScript props interfaces
- Ensure i18n for all user-visible strings
- Add accessibility labels (aria-label, etc.)

---

## Phase 6: Test Infrastructure

### 6.1 Vitest Setup
**New files:**
- `vitest.config.ts`
- `src/test/setup.ts`
- `src/test/mocks/` - Mock implementations of all interfaces

### 6.2 Test Utilities
**New file: `src/test/TestServiceContainer.ts`**
```typescript
function createTestServices(overrides?: Partial<ServiceContainer>): ServiceContainer;
function createTestStores(initialState?: Partial<StoresState>): Stores;
```

---

## File Changes Summary

### New Files
```
src/
├── config/
│   └── index.ts              # App configuration
├── di/
│   ├── ServiceContainer.ts   # DI container interface
│   └── ServiceContext.tsx    # Preact Context provider
├── stores/
│   ├── SettingsStore.ts
│   ├── ConversionStore.ts
│   ├── LLMStore.ts
│   ├── LogStore.ts
│   └── StoreContext.tsx
├── services/
│   ├── interfaces.ts         # All service interfaces
│   ├── ConversionOrchestrator.ts
│   ├── LoggerService.ts
│   └── (existing services refactored to implement interfaces)
├── errors/
│   └── index.ts              # Structured errors
├── utils/
│   └── RetryStrategy.ts
├── styles/
│   └── components.css        # Extracted inline styles
└── test/
    ├── setup.ts
    ├── mocks/
    └── TestServiceContainer.ts
```

### Modified Files
```
src/
├── state/
│   ├── appState.ts           # DELETE (replaced by stores)
│   ├── llmState.ts           # DELETE (replaced by stores)
│   └── types.ts              # Keep and extend
├── services/
│   ├── EdgeTTSService.ts     # Implement ITTSService
│   ├── TTSWorkerPool.ts      # Implement IWorkerPool
│   ├── AudioMerger.ts        # Implement IAudioMerger
│   ├── LLMVoiceService.ts    # Implement ILLMService
│   └── FFmpegService.ts      # Implement IFFmpegService
├── hooks/
│   └── useTTSConversion.ts   # Simplify to use orchestrator
├── components/
│   ├── StatusArea.tsx        # Enhanced logging UI
│   ├── Settings/*.tsx        # Remove inline styles
│   └── (all components)      # Use stores via hooks
├── App.tsx                   # Wrap with providers
└── index.tsx                 # Setup DI container
```

---

## Implementation Order

1. **Phase 1.1-1.3**: Service interfaces + config extraction (foundation)
2. **Phase 2**: State stores (breaks existing code temporarily)
3. **Phase 3**: Orchestrator + hook refactor
4. **Phase 4**: Error handling + logging
5. **Phase 5**: UI improvements
6. **Phase 6**: Test setup (ready for tests, not writing tests yet)

---

## Critical Files to Read Before Implementation
- `src/hooks/useTTSConversion.ts` (428 lines - main orchestration)
- `src/state/appState.ts` (151 lines - current state)
- `src/services/TTSWorkerPool.ts` (201 lines - retry logic)
- `src/services/LLMVoiceService.ts` (LLM integration)
- `src/components/StatusArea.tsx` (logging UI)
