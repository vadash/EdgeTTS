# Implementation Plan - Architectural Refactoring (SOLID & Separation of Concerns)

> **Reference:** `tmp/rpz.txt` (Phase 1 review feedback)
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Extract `buildFilterChain` into a Pure Function

**Goal:** Move the filter chain builder out of `FFmpegService` into a standalone pure function for isolated testability.

**Step 1: Write the Failing Test**
- File: `src/services/audio/buildFilterChain.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { buildFilterChain } from './buildFilterChain';

  describe('buildFilterChain', () => {
    const allOff = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };

    it('returns empty string when all filters disabled', () => {
      expect(buildFilterChain(allOff)).toBe('');
    });

    it('includes EQ filters when eq enabled', () => {
      const chain = buildFilterChain({ ...allOff, eq: true });
      expect(chain).toContain('highpass=f=60');
      expect(chain).toContain('lowshelf=f=120:g=2');
      expect(chain).toContain('equalizer=f=3000:t=q:w=1:g=-2');
    });

    it('includes deesser when deEss enabled', () => {
      const chain = buildFilterChain({ ...allOff, deEss: true });
      expect(chain).toContain('deesser=');
    });

    it('includes silenceremove when silenceRemoval enabled', () => {
      const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
      expect(chain).toContain('silenceremove=');
    });

    it('includes compand when compressor enabled', () => {
      const chain = buildFilterChain({ ...allOff, compressor: true });
      expect(chain).toContain('compand=');
    });

    it('includes loudnorm and alimiter when normalization enabled', () => {
      const chain = buildFilterChain({ ...allOff, normalization: true });
      expect(chain).toContain('loudnorm=');
      expect(chain).toContain('alimiter=');
    });

    it('includes afade when fadeIn enabled', () => {
      const chain = buildFilterChain({ ...allOff, fadeIn: true });
      expect(chain).toContain('afade=t=in');
    });

    it('includes aecho when stereoWidth enabled', () => {
      const chain = buildFilterChain({ ...allOff, stereoWidth: true });
      expect(chain).toContain('aecho=');
    });

    it('chains multiple filters with commas', () => {
      const chain = buildFilterChain({ ...allOff, eq: true, deEss: true });
      expect(chain).toMatch(/highpass.*,.*deesser/);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/audio/buildFilterChain.test.ts`
- Expect: Fail — module not found

**Step 3: Implementation (Green)**
- File: `src/services/audio/buildFilterChain.ts`
- Action: Create new file. Move the `buildFilterChain` method body from `FFmpegService.ts:280-350` into an exported pure function.
  ```typescript
  import type { AudioProcessingConfig } from '../FFmpegService';
  import { defaultConfig } from '@/config';

  /**
   * Build FFmpeg audio filter chain string from config flags.
   * Pure function — no side effects.
   */
  export function buildFilterChain(config: AudioProcessingConfig): string {
    // Copy the exact body from FFmpegService.buildFilterChain
    // (8-step pipeline: EQ, de-ess, silence removal, compressor,
    //  normalization+limiter, fade-in, stereo width)
  }
  ```
- File: `src/services/FFmpegService.ts`
- Action: Replace private `buildFilterChain` method with import:
  ```typescript
  import { buildFilterChain } from './audio/buildFilterChain';
  ```
  In `processAudio`, change `this.buildFilterChain(config)` → `buildFilterChain(config)`.
  Delete the private method.

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/audio/buildFilterChain.test.ts`
- Expect: PASS
- Command: `npx vitest run src/services/FFmpegService.test.ts`
- Expect: PASS (existing tests still pass)
- Command: `npm test`
- Expect: All tests PASS

**Step 5: Cleanup**
- Delete `src/services/FFmpegService.test.ts` — its `buildFilterChain` tests are now covered by the new file.
  If it has other tests beyond `buildFilterChain`, keep the file and only remove the `buildFilterChain` describe block.

**Step 6: Git Commit**
- Command: `git add . && git commit -m "refactor: extract buildFilterChain into pure function"`

---

## Task 2: Extract Voting Consensus into Pure Functions

**Goal:** Move `majorityVote` and `buildMergeConsensus` (with union-find) out of `LLMVoiceService.ts` into a standalone module.

**Step 1: Write the Failing Test**
- File: `src/services/llm/votingConsensus.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { majorityVote, buildMergeConsensus } from './votingConsensus';

  describe('majorityVote', () => {
    it('returns code with >=2 votes', () => {
      expect(majorityVote(['A', 'B', 'A'], 0)).toBe('A');
    });

    it('returns first vote as tiebreaker when no majority', () => {
      expect(majorityVote(['A', 'B', 'C'], 0)).toBe('A');
    });

    it('handles undefined votes', () => {
      expect(majorityVote([undefined, 'A', 'A'], 0)).toBe('A');
    });

    it('returns undefined when all votes undefined', () => {
      expect(majorityVote([undefined, undefined, undefined], 0)).toBeUndefined();
    });
  });

  describe('buildMergeConsensus', () => {
    it('returns empty array when no votes', () => {
      expect(buildMergeConsensus([])).toEqual([]);
    });

    it('returns empty array when no pair has >=2 votes', () => {
      const votes = [
        [[0, 1]],  // vote 1: merge 0,1
      ];
      expect(buildMergeConsensus(votes)).toEqual([]);
    });

    it('merges pair appearing in >=2 votes', () => {
      const votes = [
        [[0, 1]],     // vote 1: merge 0,1
        [[0, 1]],     // vote 2: merge 0,1
        [],            // vote 3: no merges
      ];
      const result = buildMergeConsensus(votes);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain(0);
      expect(result[0]).toContain(1);
    });

    it('builds transitive groups via union-find', () => {
      // If 0-1 has consensus AND 1-2 has consensus, all three merge
      const votes = [
        [[0, 1], [1, 2]],
        [[0, 1], [1, 2]],
        [[0, 1]],
      ];
      const result = buildMergeConsensus(votes);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(3);
    });

    it('keeps most-voted index first in group', () => {
      const votes = [
        [[0, 1, 2]],  // keep=0
        [[0, 1, 2]],  // keep=0
        [[1, 0, 2]],  // keep=1
      ];
      const result = buildMergeConsensus(votes);
      expect(result[0][0]).toBe(0); // 0 was keep in 2/3 votes
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/votingConsensus.test.ts`
- Expect: Fail — module not found

**Step 3: Implementation (Green)**
- File: `src/services/llm/votingConsensus.ts`
- Action: Create new file. Move functions from `LLMVoiceService.ts`:
  - `majorityVote` (lines 83-101)
  - `buildMergeConsensus` (lines 107-205)
  - Export both as named exports
  - Import `ILogger` type for the optional logger parameter
- File: `src/services/llm/LLMVoiceService.ts`
- Action:
  - Add import: `import { majorityVote, buildMergeConsensus } from './votingConsensus';`
  - Delete the `majorityVote` function definition (lines 83-101)
  - Delete the `buildMergeConsensus` function definition (lines 107-205)

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/votingConsensus.test.ts`
- Expect: PASS
- Command: `npm test`
- Expect: All tests PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "refactor: extract voting consensus into pure functions"`

---

## Task 3: Extract `saveLog` from `LLMApiClient` into `DebugLogger`

**Goal:** Remove file system writing from the API client. Create a `DebugLogger` service that handles log file persistence.

**Step 1: Write the Failing Test**
- File: `src/services/llm/DebugLogger.test.ts`
- Code:
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { DebugLogger } from './DebugLogger';

  function createMockDirectoryHandle() {
    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    const mockLogsFolder = {
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
    };
    const mockDirHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue(mockLogsFolder),
    } as unknown as FileSystemDirectoryHandle;

    return { mockDirHandle, mockLogsFolder, mockFileHandle, mockWritable };
  }

  describe('DebugLogger', () => {
    it('writes JSON to logs folder', async () => {
      const { mockDirHandle, mockLogsFolder, mockWritable } = createMockDirectoryHandle();
      const logger = new DebugLogger(mockDirHandle);

      await logger.saveLog('test.json', { foo: 'bar' });

      expect(mockDirHandle.getDirectoryHandle).toHaveBeenCalledWith('logs', { create: true });
      expect(mockLogsFolder.getFileHandle).toHaveBeenCalledWith('test.json', { create: true });
      expect(mockWritable.write).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }, null, 2));
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it('does nothing when no directory handle', async () => {
      const logger = new DebugLogger(null);
      // Should not throw
      await logger.saveLog('test.json', { data: 1 });
    });

    it('swallows errors and logs warning', async () => {
      const mockDirHandle = {
        getDirectoryHandle: vi.fn().mockRejectedValue(new Error('FS error')),
      } as unknown as FileSystemDirectoryHandle;
      const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const logger = new DebugLogger(mockDirHandle, mockLogger as any);

      await logger.saveLog('test.json', { data: 1 });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to save log',
        expect.objectContaining({ error: 'FS error' })
      );
    });

    it('tracks first-call-per-pass via shouldLog/markLogged', () => {
      const logger = new DebugLogger(null);
      expect(logger.shouldLog('extract')).toBe(true);
      logger.markLogged('extract');
      expect(logger.shouldLog('extract')).toBe(false);

      // Reset
      logger.resetLogging();
      expect(logger.shouldLog('extract')).toBe(true);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/DebugLogger.test.ts`
- Expect: Fail — module not found

**Step 3: Implementation (Green)**
- File: `src/services/llm/DebugLogger.ts`
- Action: Create new file.
  ```typescript
  import type { ILogger } from '../interfaces';
  import type { PassType } from './LLMApiClient';

  /**
   * Handles debug log file persistence to the user's file system.
   * Extracted from LLMApiClient to respect SRP.
   */
  export class DebugLogger {
    private logged = new Set<string>();

    constructor(
      private directoryHandle: FileSystemDirectoryHandle | null | undefined,
      private logger?: ILogger
    ) {}

    /** Save a JSON object to the logs/ subfolder */
    async saveLog(filename: string, content: object): Promise<void> {
      if (!this.directoryHandle) return;
      try {
        const logsFolder = await this.directoryHandle.getDirectoryHandle('logs', { create: true });
        const fileHandle = await logsFolder.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(content, null, 2));
        await writable.close();
      } catch (e) {
        this.logger?.warn('Failed to save log', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    /** Check if this pass type has been logged already */
    shouldLog(pass: PassType): boolean {
      return !this.logged.has(pass);
    }

    /** Mark a pass type as logged */
    markLogged(pass: PassType): void {
      this.logged.add(pass);
    }

    /** Reset logging flags for a new conversion */
    resetLogging(): void {
      this.logged.clear();
    }
  }
  ```
- File: `src/services/llm/LLMApiClient.ts`
- Action:
  - Remove `directoryHandle` from `LLMApiClientOptions` interface
  - Remove `private logged*` tracking fields and `resetLogging()` method
  - Remove `private async saveLog(...)` method
  - Add `debugLogger?: DebugLogger` to constructor options
  - Replace all `this.saveLog(...)` calls with `this.debugLogger?.saveLog(...)` (guarded)
  - Replace `this.logged*` checks with `this.debugLogger?.shouldLog(pass)` / `this.debugLogger?.markLogged(pass)`
  - Update `resetLogging()` to delegate: `this.debugLogger?.resetLogging()`

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/DebugLogger.test.ts`
- Expect: PASS
- Command: `npm test`
- Expect: All tests PASS

**Step 5: Update Callers**
- Search all files importing `LLMApiClient` or passing `directoryHandle` to it.
- Update them to create a `DebugLogger` instance and pass it instead.
- Likely locations: `LLMVoiceService.ts` constructor, pipeline step factories.

**Step 6: Verify Full Suite**
- Command: `npm test`
- Expect: All tests PASS

**Step 7: Git Commit**
- Command: `git add . && git commit -m "refactor: extract saveLog from LLMApiClient into DebugLogger"`

---

## Task 4: Decouple `ConversionOrchestrator` from Preact Signals

**Goal:** Replace direct `stores.*` signal reads/writes with a callback/event interface, making the orchestrator testable without Preact signal infrastructure.

**Step 1: Define the Callback Interface**
- File: `src/services/OrchestratorCallbacks.ts`
- Code:
  ```typescript
  import type { PipelineProgress } from './pipeline/types';
  import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
  import type { ResumeInfo } from './pipeline/resumeCheck';

  /**
   * Input configuration snapshot — read once at the start of run().
   * All signal .value reads are replaced by fields on this object.
   */
  export interface OrchestratorInput {
    // LLM config
    isLLMConfigured: boolean;
    extractConfig: { apiKey: string; apiUrl: string; model: string; streaming: boolean; reasoning?: string; temperature: number; topP: number };
    mergeConfig: { apiKey: string; apiUrl: string; model: string; streaming: boolean; reasoning?: string; temperature: number; topP: number };
    assignConfig: { apiKey: string; apiUrl: string; model: string; streaming: boolean; reasoning?: string; temperature: number; topP: number };
    useVoting: boolean;

    // Settings
    narratorVoice: string;
    voice: string;
    pitch: string;
    rate: string;
    ttsThreads: number;
    llmThreads: number;
    enabledVoices: string[];
    lexxRegister: string;
    outputFormat: string;
    silenceRemoval: boolean;
    normalization: boolean;
    deEss: boolean;
    silenceGapMs: number;
    eq: boolean;
    compressor: boolean;
    fadeIn: boolean;
    stereoWidth: boolean;
    opusMinBitrate: number;
    opusMaxBitrate: number;
    opusCompressionLevel: number;

    // Data
    directoryHandle: FileSystemDirectoryHandle | null;
    detectedLanguage: string;
    dictionaryRaw: string;
    textContent: string;
  }

  /**
   * Callbacks for the orchestrator to communicate state changes to the UI layer.
   */
  export interface OrchestratorCallbacks {
    onConversionStart: () => void;
    onConversionComplete: () => void;
    onConversionCancel: () => void;
    onError: (message: string, code: string) => void;
    onProgress: (progress: PipelineProgress) => void;
    onStatusChange: (status: string) => void;
    onBlockProgress: (current: number, total: number) => void;
    onLLMProcessingStatus: (status: string) => void;

    // Resume flow
    awaitResumeConfirmation: (info: ResumeInfo) => Promise<boolean>;

    // Voice review pause
    onCharactersReady: (characters: LLMCharacter[]) => void;
    onVoiceMapReady: (voiceMap: Map<string, string>) => void;
    onAssignmentsReady: (assignments: SpeakerAssignment[]) => void;
    awaitVoiceReview: () => Promise<{ voiceMap: Map<string, string>; existingProfile: unknown }>;

    // Cleanup
    clearTextContent: () => void;
    startTimer: () => void;
    resetLLMState: () => void;
  }
  ```

**Step 2: Write the Failing Test**
- File: `src/services/__tests__/ConversionOrchestrator.test.ts`
- Code:
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { ConversionOrchestrator } from '../ConversionOrchestrator';
  import type { OrchestratorInput, OrchestratorCallbacks } from '../OrchestratorCallbacks';

  function createMockInput(overrides?: Partial<OrchestratorInput>): OrchestratorInput {
    return {
      isLLMConfigured: true,
      directoryHandle: {} as FileSystemDirectoryHandle,
      detectedLanguage: 'en',
      enabledVoices: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
      textContent: 'Hello world',
      dictionaryRaw: '',
      narratorVoice: 'narrator',
      voice: 'default',
      pitch: '+0Hz',
      rate: '+0%',
      ttsThreads: 2,
      llmThreads: 1,
      useVoting: false,
      lexxRegister: '',
      outputFormat: 'opus',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      opusMinBitrate: 24,
      opusMaxBitrate: 64,
      opusCompressionLevel: 10,
      extractConfig: { apiKey: 'k', apiUrl: 'u', model: 'm', streaming: false, temperature: 0, topP: 1 },
      mergeConfig: { apiKey: 'k', apiUrl: 'u', model: 'm', streaming: false, temperature: 0, topP: 1 },
      assignConfig: { apiKey: 'k', apiUrl: 'u', model: 'm', streaming: false, temperature: 0, topP: 1 },
      ...overrides,
    };
  }

  function createMockCallbacks(): OrchestratorCallbacks {
    return {
      onConversionStart: vi.fn(),
      onConversionComplete: vi.fn(),
      onConversionCancel: vi.fn(),
      onError: vi.fn(),
      onProgress: vi.fn(),
      onStatusChange: vi.fn(),
      onBlockProgress: vi.fn(),
      onLLMProcessingStatus: vi.fn(),
      awaitResumeConfirmation: vi.fn().mockResolvedValue(false),
      onCharactersReady: vi.fn(),
      onVoiceMapReady: vi.fn(),
      onAssignmentsReady: vi.fn(),
      awaitVoiceReview: vi.fn().mockResolvedValue({ voiceMap: new Map(), existingProfile: null }),
      clearTextContent: vi.fn(),
      startTimer: vi.fn(),
      resetLLMState: vi.fn(),
    };
  }

  describe('ConversionOrchestrator', () => {
    it('throws when text is empty', async () => {
      const orch = new ConversionOrchestrator(/* container mock */, createMockCallbacks());
      const input = createMockInput({ textContent: '' });
      await expect(orch.run(input)).rejects.toThrow();
    });

    it('throws when LLM not configured', async () => {
      const orch = new ConversionOrchestrator(/* container mock */, createMockCallbacks());
      const input = createMockInput({ isLLMConfigured: false });
      await expect(orch.run(input)).rejects.toThrow('LLM_NOT_CONFIGURED');
    });

    it('calls onConversionStart on successful init', async () => {
      // This test requires mocking the pipeline builder; detailed mock setup
      // depends on the DI container implementation
    });
  });
  ```
  Note: The exact mock setup for `ServiceContainer` depends on the DI system. Adapt using `createTestContainer` from test infrastructure.

**Step 3: Run Test (Red)**
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.test.ts`
- Expect: Fail — constructor signature mismatch

**Step 4: Implementation (Green)**
- File: `src/services/ConversionOrchestrator.ts`
- Action:
  1. Change constructor to accept `OrchestratorCallbacks` instead of `Stores`:
     ```typescript
     constructor(
       private container: ServiceContainer,
       private callbacks: OrchestratorCallbacks
     )
     ```
  2. Change `run(text, existingBook?)` signature to `run(input: OrchestratorInput, existingBook?)`:
     - Replace all `this.stores.llm.isConfigured.value` → `input.isLLMConfigured`
     - Replace all `this.stores.data.directoryHandle.value` → `input.directoryHandle`
     - Replace all `this.stores.settings.*.value` → `input.*`
     - Replace `this.stores.conversion.startConversion()` → `this.callbacks.onConversionStart()`
     - Replace `this.stores.logs.startTimer()` → `this.callbacks.startTimer()`
     - Replace `this.stores.llm.resetProcessingState()` → `this.callbacks.resetLLMState()`
     - Replace `this.stores.data.setTextContent('')` → `this.callbacks.clearTextContent()`
     - Replace `this.stores.data.setBook(null)` → (remove, or add callback if needed)
     - Replace `this.stores.conversion.complete()` → `this.callbacks.onConversionComplete()`
     - Replace error handling stores calls → `this.callbacks.onError(...)` / `this.callbacks.onConversionCancel()`
  3. Rewrite `handleProgress` to use `this.callbacks.onProgress(...)`, `this.callbacks.onStatusChange(...)`, `this.callbacks.onBlockProgress(...)`, `this.callbacks.onLLMProcessingStatus(...)`
  4. Rewrite `cancel()` to use callbacks
  5. Rewrite the pause callback to use `this.callbacks.awaitVoiceReview()`

**Step 5: Create the Adapter Hook**
- File: `src/hooks/useConversionOrchestrator.ts` (or update existing caller)
- Action: Create a thin adapter that reads from stores and constructs `OrchestratorInput` + `OrchestratorCallbacks`:
  ```typescript
  function buildInput(stores: Stores): OrchestratorInput {
    return {
      isLLMConfigured: stores.llm.isConfigured.value,
      directoryHandle: stores.data.directoryHandle.value,
      // ... all other fields from stores
    };
  }

  function buildCallbacks(stores: Stores): OrchestratorCallbacks {
    return {
      onConversionStart: () => stores.conversion.startConversion(),
      onConversionComplete: () => stores.conversion.complete(),
      // ... all other callbacks writing to stores
    };
  }
  ```

**Step 6: Update All Callers**
- Search for `new ConversionOrchestrator(` and `createConversionOrchestrator(` — update to pass callbacks instead of stores.
- Remove `Stores` import from `ConversionOrchestrator.ts`.

**Step 7: Verify (Green)**
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.test.ts`
- Expect: PASS
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.resume.test.ts`
- Expect: PASS (existing resume tests updated to new interface)
- Command: `npm test`
- Expect: All tests PASS

**Step 8: Git Commit**
- Command: `git add . && git commit -m "refactor: decouple ConversionOrchestrator from Preact Signals"`

---

## Dependency Order

```
Task 1 (buildFilterChain)  ─┐
Task 2 (votingConsensus)   ─┤── Independent, can be done in any order
Task 3 (DebugLogger)       ─┘
Task 4 (Orchestrator)      ─── Do last (largest scope, most callers to update)
```

Tasks 1-3 are independent and touch different files. Task 4 is the largest refactor and should be done last to minimize merge conflicts.
