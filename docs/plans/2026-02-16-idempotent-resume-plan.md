# Implementation Plan - Idempotent Resume

> **Reference:** `docs/designs/2026-02-16-idempotent-resume-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Job Signature Utility

**Goal:** Create a pure utility to generate and compare job signatures from text + settings.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/__tests__/jobSignature.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { generateSignature, signaturesMatch } from '../jobSignature';

  describe('jobSignature', () => {
    const baseSettings = {
      voice: 'en-US-AriaNeural',
      rate: '+0%',
      pitch: '+0Hz',
      outputFormat: 'opus' as const,
      opusBitrate: '32k',
    };

    describe('generateSignature', () => {
      it('generates a signature object with version and textHash', () => {
        const sig = generateSignature('Hello world', baseSettings);
        expect(sig.version).toBe(1);
        expect(sig.textHash).toBeTypeOf('string');
        expect(sig.textHash.length).toBeGreaterThan(0);
        expect(sig.voice).toBe('en-US-AriaNeural');
        expect(sig.rate).toBe('+0%');
        expect(sig.pitch).toBe('+0Hz');
        expect(sig.outputFormat).toBe('opus');
        expect(sig.opusBitrate).toBe('32k');
        expect(sig.createdAt).toBeTypeOf('string');
      });

      it('produces identical hashes for identical text', () => {
        const sig1 = generateSignature('Same text', baseSettings);
        const sig2 = generateSignature('Same text', baseSettings);
        expect(sig1.textHash).toBe(sig2.textHash);
      });

      it('produces different hashes for different text', () => {
        const sig1 = generateSignature('Text A', baseSettings);
        const sig2 = generateSignature('Text B', baseSettings);
        expect(sig1.textHash).not.toBe(sig2.textHash);
      });

      it('uses first/last 200 chars + length for hash (long text)', () => {
        const longText = 'A'.repeat(500) + 'B'.repeat(500);
        const sig1 = generateSignature(longText, baseSettings);
        // Same prefix/suffix/length = same hash
        const sig2 = generateSignature(longText, baseSettings);
        expect(sig1.textHash).toBe(sig2.textHash);

        // Different middle but same first/last 200 + same length
        const altText = 'A'.repeat(500) + 'C'.repeat(500);
        const sig3 = generateSignature(altText, baseSettings);
        // Last 200 chars differ (B vs C), so hash differs
        expect(sig1.textHash).not.toBe(sig3.textHash);
      });
    });

    describe('signaturesMatch', () => {
      it('returns true for matching signatures', () => {
        const sig1 = generateSignature('Hello', baseSettings);
        const sig2 = generateSignature('Hello', baseSettings);
        expect(signaturesMatch(sig1, sig2)).toBe(true);
      });

      it('returns false when voice differs', () => {
        const sig1 = generateSignature('Hello', baseSettings);
        const sig2 = generateSignature('Hello', { ...baseSettings, voice: 'en-US-GuyNeural' });
        expect(signaturesMatch(sig1, sig2)).toBe(false);
      });

      it('returns false when text differs', () => {
        const sig1 = generateSignature('Hello', baseSettings);
        const sig2 = generateSignature('World', baseSettings);
        expect(signaturesMatch(sig1, sig2)).toBe(false);
      });

      it('returns false when version differs', () => {
        const sig1 = generateSignature('Hello', baseSettings);
        const sig2 = { ...generateSignature('Hello', baseSettings), version: 99 };
        expect(signaturesMatch(sig1, sig2)).toBe(false);
      });
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/pipeline/__tests__/jobSignature.test.ts`
- Expect: Fail — module not found

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/jobSignature.ts`
- Logic:
  ```typescript
  export interface JobSignature {
    version: number;
    textHash: string;
    voice: string;
    rate: string;
    pitch: string;
    outputFormat: string;
    opusBitrate: string;
    createdAt: string;
  }

  export interface SignatureSettings {
    voice: string;
    rate: string;
    pitch: string;
    outputFormat: 'mp3' | 'opus';
    opusBitrate: string;
  }

  /**
   * Lightweight text fingerprint: SHA-256 of (length + first 200 chars + last 200 chars).
   * Uses SubtleCrypto in browser, falls back to simple hash for tests.
   */
  function textFingerprint(text: string): string {
    const prefix = text.slice(0, 200);
    const suffix = text.slice(-200);
    const raw = `${text.length}:${prefix}:${suffix}`;
    // Simple non-crypto hash for synchronous use (djb2)
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  export function generateSignature(text: string, settings: SignatureSettings): JobSignature {
    return {
      version: 1,
      textHash: textFingerprint(text),
      voice: settings.voice,
      rate: settings.rate,
      pitch: settings.pitch,
      outputFormat: settings.outputFormat,
      opusBitrate: settings.opusBitrate,
      createdAt: new Date().toISOString(),
    };
  }

  export function signaturesMatch(a: JobSignature, b: JobSignature): boolean {
    return (
      a.version === b.version &&
      a.textHash === b.textHash &&
      a.voice === b.voice &&
      a.rate === b.rate &&
      a.pitch === b.pitch &&
      a.outputFormat === b.outputFormat &&
      a.opusBitrate === b.opusBitrate
    );
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/pipeline/__tests__/jobSignature.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): add job signature generation and comparison utility"`

---

### Task 2: Orchestrator — Signature Check & Resume Detection

**Goal:** Replace blind `_temp_work` deletion with signature-based cache validation. Add `checkResumable()` method and `onResumeDetected` callback.

**Step 1: Write the Failing Test**
- File: `src/services/__tests__/ConversionOrchestrator.resume.test.ts`
- Code: Test that the orchestrator:
  1. Reads `_temp_work/job_signature.json` from the directory handle
  2. If signature matches → does NOT delete `_temp_work`, calls `onResumeDetected` callback
  3. If signature mismatches → deletes `_temp_work`, writes new signature
  4. If no `_temp_work` exists → creates it, writes signature
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { createMockDirectoryHandle } from '@/test/pipeline/helpers';
  import { generateSignature, type JobSignature } from '@/services/pipeline/jobSignature';

  // Test the checkResumable logic extracted as a standalone function
  import { checkResumeState, type ResumeCheckResult } from '@/services/pipeline/resumeCheck';

  describe('checkResumeState', () => {
    const settings = {
      voice: 'en-US-AriaNeural',
      rate: '+0%',
      pitch: '+0Hz',
      outputFormat: 'opus' as const,
      opusBitrate: '32k',
    };

    it('returns null when _temp_work does not exist', async () => {
      const dirHandle = createMockDirectoryHandle();
      const result = await checkResumeState(dirHandle, 'Hello', settings);
      expect(result).toBeNull();
    });

    it('returns ResumeInfo when signature matches and chunks exist', async () => {
      const dirHandle = createMockDirectoryHandle();
      // Setup: _temp_work exists with matching signature and some chunk files
      const sig = generateSignature('Hello', settings);
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      // Write signature
      const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
      const sigWritable = await sigFile.createWritable();
      await sigWritable.write(JSON.stringify(sig));
      await sigWritable.close();
      // Write a fake chunk file
      const chunkFile = await tempDir.getFileHandle('chunk_0001.bin', { create: true });
      const chunkWritable = await chunkFile.createWritable();
      await chunkWritable.write(new Uint8Array([1, 2, 3]));
      await chunkWritable.close();

      const result = await checkResumeState(dirHandle, 'Hello', settings);
      expect(result).not.toBeNull();
      expect(result!.cachedChunks).toBe(1);
    });

    it('returns null when signature does not match', async () => {
      const dirHandle = createMockDirectoryHandle();
      const oldSig = generateSignature('Old text', settings);
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
      const sigWritable = await sigFile.createWritable();
      await sigWritable.write(JSON.stringify(oldSig));
      await sigWritable.close();

      const result = await checkResumeState(dirHandle, 'New text', settings);
      expect(result).toBeNull();
    });

    it('detects pipeline_state.json for LLM cache', async () => {
      const dirHandle = createMockDirectoryHandle();
      const sig = generateSignature('Hello', settings);
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      // Write signature
      const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
      const sigWritable = await sigFile.createWritable();
      await sigWritable.write(JSON.stringify(sig));
      await sigWritable.close();
      // Write pipeline state
      const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
      const stateWritable = await stateFile.createWritable();
      await stateWritable.write(JSON.stringify({ assignments: [], characterVoiceMap: {}, fileNames: [] }));
      await stateWritable.close();

      const result = await checkResumeState(dirHandle, 'Hello', settings);
      expect(result).not.toBeNull();
      expect(result!.hasLLMState).toBe(true);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.resume.test.ts`
- Expect: Fail — module `resumeCheck` not found

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/resumeCheck.ts`
- Logic:
  - `checkResumeState(dirHandle, text, settings)` → tries to open `_temp_work`, read `job_signature.json`, compare with `generateSignature(text, settings)`
  - If match: scan for `chunk_*.bin` files (count them), check for `pipeline_state.json`
  - Return `ResumeInfo | null`
  ```typescript
  import { generateSignature, signaturesMatch, type SignatureSettings, type JobSignature } from './jobSignature';

  export interface ResumeInfo {
    cachedChunks: number;
    totalChunks: number;
    cachedOutputFiles: number;
    hasLLMState: boolean;
  }

  export type ResumeCheckResult = ResumeInfo | null;

  async function tryGetDirectory(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
    try { return await parent.getDirectoryHandle(name); }
    catch { return null; }
  }

  async function tryReadJSON<T>(dir: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
    try {
      const fileHandle = await dir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text()) as T;
    } catch { return null; }
  }

  async function countChunkFiles(dir: FileSystemDirectoryHandle): Promise<number> {
    let count = 0;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.bin') && name.startsWith('chunk_')) {
        count++;
      }
    }
    return count;
  }

  async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try { await dir.getFileHandle(name); return true; }
    catch { return false; }
  }

  export async function checkResumeState(
    dirHandle: FileSystemDirectoryHandle,
    text: string,
    settings: SignatureSettings,
  ): Promise<ResumeCheckResult> {
    const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
    if (!tempDir) return null;

    const savedSig = await tryReadJSON<JobSignature>(tempDir, 'job_signature.json');
    if (!savedSig) return null;

    const currentSig = generateSignature(text, settings);
    if (!signaturesMatch(savedSig, currentSig)) return null;

    const cachedChunks = await countChunkFiles(tempDir);
    const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');

    return {
      cachedChunks,
      totalChunks: savedSig.chunkCount ?? 0,
      cachedOutputFiles: 0, // counted later by merge step
      hasLLMState,
    };
  }

  export async function writeSignature(
    dirHandle: FileSystemDirectoryHandle,
    text: string,
    settings: SignatureSettings,
  ): Promise<void> {
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    const sig = generateSignature(text, settings);
    const fileHandle = await tempDir.getFileHandle('job_signature.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(sig));
    await writable.close();
  }
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.resume.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): add resume state detection from _temp_work directory"`

---

### Task 3: SpeakerAssignmentStep — Save pipeline_state.json

**Goal:** After LLM speaker assignment completes, write `pipeline_state.json` to `_temp_work`.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/steps/SpeakerAssignmentStep.test.ts` (add to existing)
- Code: Add a new describe block:
  ```typescript
  describe('pipeline state persistence', () => {
    it('writes pipeline_state.json to tempDir after assignment', async () => {
      // Setup: context with directoryHandle containing _temp_work
      const dirHandle = createMockDirectoryHandle();
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });

      const context = createContextWithVoiceMap({
        directoryHandle: dirHandle,
      });

      const result = await step.execute(context, neverAbortSignal);

      // Verify pipeline_state.json was written
      const stateFile = await tempDir.getFileHandle('pipeline_state.json');
      const file = await stateFile.getFile();
      const state = JSON.parse(await file.text());
      expect(state.assignments).toBeDefined();
      expect(Array.isArray(state.assignments)).toBe(true);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/pipeline/steps/SpeakerAssignmentStep.test.ts`
- Expect: Fail — pipeline_state.json not found

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/steps/SpeakerAssignmentStep.ts`
- Action: At the end of `execute()`, after the `assignSpeakers` call, write the state:
  ```typescript
  // After: return { ...context, assignments };
  // Before returning, save pipeline state to _temp_work
  if (context.directoryHandle) {
    try {
      const tempDir = await context.directoryHandle.getDirectoryHandle('_temp_work', { create: true });
      const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
      const writable = await stateFile.createWritable();
      const state = {
        assignments,
        characterVoiceMap: Object.fromEntries(voiceMap),
        fileNames: context.fileNames,
      };
      await writable.write(JSON.stringify(state));
      await writable.close();
      this.reportProgress(blocks.length, blocks.length, 'Saved pipeline state for resume');
    } catch {
      // Non-fatal: resume just won't have LLM cache
    }
  }

  return { ...context, assignments };
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/pipeline/steps/SpeakerAssignmentStep.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): save pipeline_state.json after speaker assignment"`

---

### Task 4: Orchestrator — LLM State Hydration & Pipeline Skip

**Goal:** When resuming with `pipeline_state.json`, load LLM state into context and skip LLM pipeline steps.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/__tests__/loadPipelineState.test.ts`
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { loadPipelineState, type PipelineState } from '../resumeCheck';
  import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

  describe('loadPipelineState', () => {
    it('returns null when pipeline_state.json does not exist', async () => {
      const dirHandle = createMockDirectoryHandle();
      await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      const result = await loadPipelineState(dirHandle);
      expect(result).toBeNull();
    });

    it('loads and parses pipeline_state.json from _temp_work', async () => {
      const dirHandle = createMockDirectoryHandle();
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      const state: PipelineState = {
        assignments: [{ text: 'Hi', speaker: 'Narrator', voiceId: 'en-US-AriaNeural' }],
        characterVoiceMap: { Narrator: 'en-US-AriaNeural' },
        fileNames: [['Chapter 1', 0]],
      };
      const file = await tempDir.getFileHandle('pipeline_state.json', { create: true });
      const w = await file.createWritable();
      await w.write(JSON.stringify(state));
      await w.close();

      const result = await loadPipelineState(dirHandle);
      expect(result).not.toBeNull();
      expect(result!.assignments).toHaveLength(1);
      expect(result!.assignments[0].speaker).toBe('Narrator');
      expect(result!.characterVoiceMap).toEqual({ Narrator: 'en-US-AriaNeural' });
    });

    it('returns null for corrupt JSON', async () => {
      const dirHandle = createMockDirectoryHandle();
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
      const file = await tempDir.getFileHandle('pipeline_state.json', { create: true });
      const w = await file.createWritable();
      await w.write('not json');
      await w.close();

      const result = await loadPipelineState(dirHandle);
      expect(result).toBeNull();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/pipeline/__tests__/loadPipelineState.test.ts`
- Expect: Fail — `loadPipelineState` not exported

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/resumeCheck.ts` — add:
  ```typescript
  export interface PipelineState {
    assignments: Array<{ text: string; speaker: string; voiceId: string }>;
    characterVoiceMap: Record<string, string>;
    fileNames: Array<[string, number]>;
  }

  export async function loadPipelineState(
    dirHandle: FileSystemDirectoryHandle,
  ): Promise<PipelineState | null> {
    const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
    if (!tempDir) return null;
    return tryReadJSON<PipelineState>(tempDir, 'pipeline_state.json');
  }
  ```

- File: `src/services/pipeline/PipelineBuilder.ts` — add `skipLLMSteps` option:
  - Add `skipLLMSteps?: boolean` to `PipelineBuilderOptions`
  - In `build()`, wrap the 4 LLM step additions with `if (!options.skipLLMSteps) { ... }`
  - The 4 steps to skip: `CHARACTER_EXTRACTION`, `VOICE_ASSIGNMENT`, `SPEAKER_ASSIGNMENT`, `VOICE_REMAPPING`

- File: `src/services/ConversionOrchestrator.ts` — update `run()`:
  - Replace the blind `removeEntry('_temp_work')` with `checkResumeState()` call
  - If resume detected + user confirms: load `pipeline_state.json`, pre-fill context, pass `skipLLMSteps: true` to builder
  - If no resume: call `writeSignature()` after creating `_temp_work`

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/pipeline/__tests__/loadPipelineState.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): load pipeline state and skip LLM steps on resume"`

---

### Task 5: TTSConversionStep — Pre-scan Cached Chunks

**Goal:** Before creating worker tasks, scan `_temp_work` for existing `chunk_*.bin` files and skip them.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/steps/TTSConversionStep.test.ts` (add to existing)
- Code: Add new describe block:
  ```typescript
  describe('resume - cached chunks', () => {
    it('skips chunks that already exist on disk', async () => {
      // Create a context where _temp_work already has chunk files
      const dirHandle = createMockDirectoryHandle();
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });

      // Pre-create chunk_0000.bin (simulating a cached chunk)
      const chunkFile = await tempDir.getFileHandle('chunk_0000.bin', { create: true });
      const w = await chunkFile.createWritable();
      await w.write(new Uint8Array([1, 2, 3]));
      await w.close();

      const assignments = [
        { text: 'Cached sentence.', speaker: 'Narrator', voiceId: 'en-US-AriaNeural' },
        { text: 'New sentence.', speaker: 'Narrator', voiceId: 'en-US-AriaNeural' },
      ];

      const context = createContextWithAssignments({
        assignments,
        directoryHandle: dirHandle,
      });

      const result = await step.execute(context, neverAbortSignal);

      // Only 1 task should have been sent to worker pool (the non-cached one)
      expect(mockWorkerPool.addTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ partIndex: 1 }),
        ])
      );
      // The cached chunk should be in audioMap
      expect(result.audioMap.has(0)).toBe(true);
    });

    it('skips worker pool entirely when all chunks cached', async () => {
      // All chunks pre-exist → no worker pool needed
      const dirHandle = createMockDirectoryHandle();
      const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });

      const chunkFile = await tempDir.getFileHandle('chunk_0000.bin', { create: true });
      const w = await chunkFile.createWritable();
      await w.write(new Uint8Array([1, 2, 3]));
      await w.close();

      const assignments = [
        { text: 'Only sentence.', speaker: 'Narrator', voiceId: 'en-US-AriaNeural' },
      ];

      const context = createContextWithAssignments({
        assignments,
        directoryHandle: dirHandle,
      });

      const result = await step.execute(context, neverAbortSignal);
      expect(result.audioMap.size).toBe(1);
      // Worker pool should not have been created or should have 0 tasks
    });

    it('reports progress for cached chunks immediately', async () => {
      const progress = collectProgress(step);
      // ... setup with cached chunks ...
      // Verify progress includes "found X cached chunks" message
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/pipeline/steps/TTSConversionStep.test.ts`
- Expect: Fail — cached chunks not skipped

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/steps/TTSConversionStep.ts`
- Action: In `execute()`, after building the `chunks` array and before creating the worker pool:
  ```typescript
  // Pre-scan for cached chunks in _temp_work
  const audioMap = new Map<number, string>();
  let tempDirHandle: FileSystemDirectoryHandle | null = null;

  try {
    tempDirHandle = await directoryHandle.getDirectoryHandle('_temp_work');
  } catch { /* no temp dir yet */ }

  if (tempDirHandle) {
    for (const chunk of chunks) {
      const filename = `chunk_${String(chunk.partIndex).padStart(4, '0')}.bin`;
      try {
        const handle = await tempDirHandle.getFileHandle(filename);
        const file = await handle.getFile();
        if (file.size > 0) {
          audioMap.set(chunk.partIndex, filename);
        }
      } catch { /* file doesn't exist, will be processed */ }
    }

    if (audioMap.size > 0) {
      this.reportProgress(audioMap.size, chunks.length,
        `Resuming: found ${audioMap.size}/${chunks.length} cached chunks`);
    }
  }

  // Filter out cached chunks
  const remainingChunks = chunks.filter(c => !audioMap.has(c.partIndex));

  if (remainingChunks.length === 0) {
    this.reportProgress(chunks.length, chunks.length, 'All chunks cached, skipping TTS');
    if (!tempDirHandle) throw new Error('Temp directory handle not available');
    return { ...context, audioMap, tempDirHandle, failedTasks: new Set<number>() };
  }

  // Continue with worker pool using remainingChunks instead of chunks...
  ```
- Update the tasks array to use `remainingChunks` instead of `chunks`
- Update the total count references to use `chunks.length` (not `remainingChunks.length`) so progress bar shows full total

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/pipeline/steps/TTSConversionStep.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): skip cached TTS chunks in TTSConversionStep"`

---

### Task 6: AudioMergeStep — Skip Existing Output Files

**Goal:** Before merging each group, check if the output file already exists in the target directory.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/steps/AudioMergeStep.test.ts` (add to existing)
- Code: Add new describe block:
  ```typescript
  describe('resume - cached output files', () => {
    it('skips merge when output file already exists with size > 0', async () => {
      // Pre-create an output file in the target directory
      const targetDir = createMockDirectoryHandle();
      const existingFile = await targetDir.getFileHandle('Chapter 1.opus', { create: true });
      const w = await existingFile.createWritable();
      await w.write(new Uint8Array(2000)); // > 1KB
      await w.close();

      const context = createContextWithAudio({
        directoryHandle: targetDir,
        fileNames: [['Chapter 1', 0]],
      });

      const result = await step.execute(context, neverAbortSignal);
      // merger.mergeAndSave should report that it skipped the existing file
      expect(result.savedFileCount).toBeGreaterThanOrEqual(0);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/pipeline/steps/AudioMergeStep.test.ts`
- Expect: Fail — no skip logic

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/steps/AudioMergeStep.ts`
- Action: The skip logic needs to be inside or before the `merger.mergeAndSave` call. Since `mergeAndSave` is a single call that handles all groups internally (via `IAudioMerger`), the cleanest approach is:
  - Pass the `directoryHandle` to the merger so it can check for existing files
  - OR: check before calling `mergeAndSave` by listing existing output files and passing a skip list
  - Simplest: add a pre-check that counts existing output files and passes a `skipFiles: Set<string>` to `mergeAndSave`. If the merger interface doesn't support this, add an optional parameter.
  - Alternative: wrap the merger call — check each expected output filename against `directoryHandle`, skip if exists and > 1KB.

  The exact implementation depends on how `mergeAndSave` iterates groups internally. If it processes files one-by-one, add skip logic inside. If it's a batch operation, add a pre-filter.

  Since `mergeAndSave` receives `fileNames` and `audioMap`, we can filter the `audioMap` to exclude groups whose output files exist. Add a helper:
  ```typescript
  private async getExistingOutputFiles(
    dirHandle: FileSystemDirectoryHandle,
    fileNames: Array<[string, number]>,
    extension: string,
  ): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const [name] of fileNames) {
      const filename = `${name}.${extension}`;
      try {
        const handle = await dirHandle.getFileHandle(filename);
        const file = await handle.getFile();
        if (file.size > 1024) { // > 1KB = not a partial write
          existing.add(name);
        }
      } catch { /* doesn't exist */ }
    }
    return existing;
  }
  ```
  Before calling `merger.mergeAndSave`, check existing files. Log skipped files. Adjust progress accordingly.

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/pipeline/steps/AudioMergeStep.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): skip existing output files in AudioMergeStep"`

---

### Task 7: ResumeModal UI Component

**Goal:** Create a simple modal that shows cached state info and lets the user confirm or cancel resume.

**Step 1: Implementation**
- File: `src/components/convert/ResumeModal.tsx`
- Code: Follow `VoiceReviewModal` patterns (same overlay, Card, Button imports):
  ```tsx
  import { Text } from 'preact-i18n';
  import { Button } from '@/components/common';

  export interface ResumeInfo {
    cachedChunks: number;
    totalChunks: number;
    cachedOutputFiles: number;
    hasLLMState: boolean;
  }

  interface ResumeModalProps {
    info: ResumeInfo;
    onContinue: () => void;
    onCancel: () => void;
  }

  export function ResumeModal({ info, onContinue, onCancel }: ResumeModalProps) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-lg shadow-xl max-w-md w-full">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-lg font-semibold">↻ Previous Session Found</h2>
          </div>
          <div className="px-4 py-4 space-y-2 text-sm">
            {info.hasLLMState && (
              <p className="text-green-400">✓ LLM voice assignments cached</p>
            )}
            {info.cachedChunks > 0 && (
              <p>{info.cachedChunks} audio chunks cached.</p>
            )}
            {info.cachedOutputFiles > 0 && (
              <p>{info.cachedOutputFiles} output files already exist.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onContinue}>Continue</Button>
          </div>
        </div>
      </div>
    );
  }
  ```

**Step 2: Wire into ConvertView**
- File: `src/components/convert/ConvertView.tsx`
- Action: Add conditional render of `ResumeModal` when resume info is available (from a signal in conversion store or a dedicated resume signal).

**Step 3: Add to barrel export**
- File: `src/components/convert/index.ts`
- Action: Add `export { ResumeModal } from './ResumeModal';`

**Step 4: Verify**
- Command: `npx vitest run` (full suite — ensure no import/type errors)
- Visual: manually verify modal renders in browser

**Step 5: Git Commit**
- `git add . && git commit -m "feat(resume): add ResumeModal UI component"`

---

### Task 8: Wire Resume Flow End-to-End

**Goal:** Connect orchestrator resume detection → modal → pipeline execution with skip/resume behavior.

**Step 1: Add resume signals to ConversionStore**
- File: `src/stores/ConversionStore.ts`
- Action: Add:
  ```typescript
  readonly resumeInfo = signal<ResumeInfo | null>(null);
  readonly resumeResolve = signal<((confirmed: boolean) => void) | null>(null);

  awaitResumeConfirmation(info: ResumeInfo): Promise<boolean> {
    this.resumeInfo.value = info;
    return new Promise<boolean>((resolve) => {
      this.resumeResolve.value = resolve;
    });
  }

  confirmResume(): void {
    this.resumeResolve.value?.(true);
    this.resumeInfo.value = null;
    this.resumeResolve.value = null;
  }

  cancelResume(): void {
    this.resumeResolve.value?.(false);
    this.resumeInfo.value = null;
    this.resumeResolve.value = null;
  }
  ```

**Step 2: Update ConversionOrchestrator.run()**
- File: `src/services/ConversionOrchestrator.ts`
- Action: Replace the `removeEntry('_temp_work')` block with:
  ```typescript
  import { checkResumeState, writeSignature, loadPipelineState } from './pipeline/resumeCheck';
  import type { SignatureSettings } from './pipeline/jobSignature';

  // In run():
  const sigSettings: SignatureSettings = {
    voice: /* from settings */,
    rate: /* from settings */,
    pitch: /* from settings */,
    outputFormat: /* from settings */,
    opusBitrate: /* from settings */,
  };

  let skipLLMSteps = false;
  let resumedAssignments = undefined;
  let resumedVoiceMap = undefined;

  const resumeInfo = await checkResumeState(directoryHandle, text, sigSettings);
  if (resumeInfo) {
    const confirmed = await this.stores.conversion.awaitResumeConfirmation(resumeInfo);
    if (!confirmed) {
      this.stores.conversion.cancel();
      return;
    }
    // Load LLM state if available
    if (resumeInfo.hasLLMState) {
      const pipelineState = await loadPipelineState(directoryHandle);
      if (pipelineState) {
        skipLLMSteps = true;
        resumedAssignments = pipelineState.assignments;
        resumedVoiceMap = new Map(Object.entries(pipelineState.characterVoiceMap));
      }
    }
  } else {
    // Fresh start: clean _temp_work and write new signature
    try { await directoryHandle.removeEntry('_temp_work', { recursive: true }); } catch {}
    await writeSignature(directoryHandle, text, sigSettings);
  }

  // Pass skipLLMSteps to pipeline builder
  const pipeline = this.pipelineBuilder.build({ ...config, skipLLMSteps });

  // If resuming with LLM state, pre-fill context
  const context: PipelineContext = {
    text,
    fileNames,
    dictionaryRules: ...,
    detectedLanguage: detectedLang,
    directoryHandle,
    ...(resumedAssignments && { assignments: resumedAssignments }),
    ...(resumedVoiceMap && { voiceMap: resumedVoiceMap }),
  };
  ```

**Step 3: Update PipelineBuilder.build()**
- File: `src/services/pipeline/PipelineBuilder.ts`
- Action: Add `skipLLMSteps?: boolean` to `PipelineBuilderOptions`. Wrap the 4 LLM step additions:
  ```typescript
  if (!options.skipLLMSteps) {
    config.addStep(StepNames.CHARACTER_EXTRACTION, { ... });
    config.addStep(StepNames.VOICE_ASSIGNMENT, { ... });
    config.addStep(StepNames.SPEAKER_ASSIGNMENT, { ... });
    config.addStep(StepNames.VOICE_REMAPPING, { ... });
  }
  ```

**Step 4: Wire ResumeModal in ConvertView**
- File: `src/components/convert/ConvertView.tsx`
- Action: Add:
  ```tsx
  const conversion = useConversion();

  {conversion.resumeInfo.value && (
    <ResumeModal
      info={conversion.resumeInfo.value}
      onContinue={() => conversion.confirmResume()}
      onCancel={() => conversion.cancelResume()}
    />
  )}
  ```

**Step 5: Verify**
- Command: `npx vitest run` (full test suite)
- Manual: trigger a conversion, cancel mid-way, convert again → verify modal appears and resume works

**Step 6: Git Commit**
- `git add . && git commit -m "feat(resume): wire end-to-end resume flow with modal confirmation"`

---

### Task 9: Write Signature After Fresh Start

**Goal:** Ensure `job_signature.json` is written to `_temp_work` at the start of a fresh conversion, so the next run can detect it.

**Step 1: Write the Failing Test**
- File: `src/services/__tests__/ConversionOrchestrator.resume.test.ts` (add to existing)
- Code:
  ```typescript
  describe('writeSignature', () => {
    it('writes job_signature.json to _temp_work', async () => {
      const dirHandle = createMockDirectoryHandle();
      await writeSignature(dirHandle, 'Hello', settings);

      const tempDir = await dirHandle.getDirectoryHandle('_temp_work');
      const sigFile = await tempDir.getFileHandle('job_signature.json');
      const file = await sigFile.getFile();
      const sig = JSON.parse(await file.text());
      expect(sig.version).toBe(1);
      expect(sig.voice).toBe('en-US-AriaNeural');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Already implemented in Task 2 as part of `resumeCheck.ts`. If not yet tested, run:
- Command: `npx vitest run src/services/__tests__/ConversionOrchestrator.resume.test.ts`
- Expect: PASS (already implemented)

**Step 3: Git Commit**
- `git add . && git commit -m "test(resume): add writeSignature test"`

---

### Task 10: Full Integration Verification

**Goal:** Run full test suite and typecheck to ensure nothing is broken.

**Step 1: Typecheck**
- Command: `npx tsc --noEmit`
- Expect: No errors

**Step 2: Full Test Suite**
- Command: `npx vitest run`
- Expect: All tests pass

**Step 3: Git Commit (final)**
- `git add . && git commit -m "feat(resume): idempotent resume for TTS, merge, and LLM steps"`
