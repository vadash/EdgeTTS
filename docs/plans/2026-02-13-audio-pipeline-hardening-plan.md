# Implementation Plan - Audio Pipeline Hardening

> **Reference:** `docs/designs/2026-02-13-audio-pipeline-hardening-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Export findSyncWord and skipID3v2Tag from MP3Parser

**Goal:** Make the two internal helper functions available for use in AudioMerger.

**Step 1: Write the Failing Test**
- File: `src/services/MP3Parser.test.ts`
- Code: Add a new describe block at the end of the file:
  ```typescript
  import { parseMP3Duration, findSyncWord, skipID3v2Tag } from './MP3Parser';
  ```
  And add:
  ```typescript
  describe('findSyncWord', () => {
    it('finds sync word at start of buffer', () => {
      const buffer = new Uint8Array([0xFF, 0xF2, 0xA4, 0xC0]);
      expect(findSyncWord(buffer, 0)).toBe(0);
    });

    it('finds sync word after junk bytes', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0xFF, 0xF2, 0xA4, 0xC0]);
      expect(findSyncWord(buffer, 0)).toBe(3);
    });

    it('returns -1 when no sync word found', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      expect(findSyncWord(buffer, 0)).toBe(-1);
    });

    it('respects startOffset parameter', () => {
      // Two sync words: at 0 and at 4
      const buffer = new Uint8Array([0xFF, 0xF2, 0x00, 0x00, 0xFF, 0xE0, 0x00]);
      expect(findSyncWord(buffer, 1)).toBe(4);
    });
  });

  describe('skipID3v2Tag', () => {
    it('returns 0 when no ID3v2 tag present', () => {
      const buffer = new Uint8Array([0xFF, 0xF2, 0xA4, 0xC0, ...new Uint8Array(280)]);
      expect(skipID3v2Tag(buffer)).toBe(0);
    });

    it('returns 0 for buffer too small for ID3v2 header', () => {
      const buffer = new Uint8Array([0x49, 0x44, 0x33]);
      expect(skipID3v2Tag(buffer)).toBe(0);
    });

    it('skips ID3v2 tag and returns correct offset', () => {
      // "ID3" marker + version 2.3 + no flags + syncsafe size of 100
      const buffer = new Uint8Array(120);
      buffer[0] = 0x49; // 'I'
      buffer[1] = 0x44; // 'D'
      buffer[2] = 0x33; // '3'
      buffer[3] = 0x02; // version major
      buffer[4] = 0x03; // version minor
      buffer[5] = 0x00; // flags
      // Syncsafe size = 100: (0 << 21) | (0 << 14) | (0 << 7) | 100
      buffer[6] = 0x00;
      buffer[7] = 0x00;
      buffer[8] = 0x00;
      buffer[9] = 0x64; // 100
      expect(skipID3v2Tag(buffer)).toBe(110); // 10 header + 100 data
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/MP3Parser.test.ts`
- Expect: Fail — `findSyncWord` and `skipID3v2Tag` are not exported.

**Step 3: Implementation (Green)**
- File: `src/services/MP3Parser.ts`
- Action: Add `export` keyword to `findSyncWord` (line 91) and `skipID3v2Tag` (line 217).
  - Change `function findSyncWord(` → `export function findSyncWord(`
  - Change `function skipID3v2Tag(` → `export function skipID3v2Tag(`

**Step 4: Verify (Green)**
- Command: `npm test src/services/MP3Parser.test.ts`
- Expect: PASS

**Step 5: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 6: Git Commit**
- `git add src/services/MP3Parser.ts src/services/MP3Parser.test.ts && git commit -m "feat: export findSyncWord and skipID3v2Tag from MP3Parser"`

---

### Task 2: Strip MP3 headers in mergeAudioGroupSync (two-pass)

**Goal:** Replace the naive concat in `mergeAudioGroupSync` with a two-pass approach that strips ID3v2 tags and pre-sync junk from each chunk.

**Step 1: Write the Failing Test**
- File: `src/services/AudioMerger.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  // We need to test that mergeAudioGroupSync strips headers.
  // Since mergeAudioGroupSync is private, we test via the public mergeAndSave path
  // with MP3 format (which uses sync merge).
  // Alternatively, test at integration level by checking output blob size.

  describe('AudioMerger - MP3 header stripping', () => {
    it('strips ID3v2 tags from merged MP3 chunks', async () => {
      // This test verifies the merged output does not contain ID3v2 headers.
      // A chunk with ID3v2 tag (10-byte header + 100 bytes data) + one valid MP3 frame (288 bytes)
      // Total chunk = 110 + 288 = 398 bytes
      // After stripping, only 288 bytes should remain per chunk.

      // Build a chunk: ID3v2 tag (110 bytes) + valid MP3 frame (288 bytes)
      const id3Header = new Uint8Array(110);
      id3Header[0] = 0x49; // 'I'
      id3Header[1] = 0x44; // 'D'
      id3Header[2] = 0x33; // '3'
      id3Header[3] = 0x02; // version
      id3Header[4] = 0x03;
      id3Header[5] = 0x00; // flags
      // Syncsafe size = 100
      id3Header[6] = 0x00;
      id3Header[7] = 0x00;
      id3Header[8] = 0x00;
      id3Header[9] = 0x64;

      const mp3Frame = new Uint8Array(288);
      mp3Frame[0] = 0xFF;
      mp3Frame[1] = 0xF2;
      mp3Frame[2] = 0xA4;
      mp3Frame[3] = 0xC0;

      const chunkWithHeader = new Uint8Array(398);
      chunkWithHeader.set(id3Header, 0);
      chunkWithHeader.set(mp3Frame, 110);

      // Import findSyncWord and skipID3v2Tag to verify they work correctly on this data
      const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

      const id3Offset = skipID3v2Tag(chunkWithHeader);
      expect(id3Offset).toBe(110);

      const syncOffset = findSyncWord(chunkWithHeader, id3Offset);
      expect(syncOffset).toBe(110);

      // The stripped length should be 288 (only the MP3 frame data)
      const strippedLength = chunkWithHeader.length - syncOffset;
      expect(strippedLength).toBe(288);
    });

    it('handles chunks without ID3v2 tags (sync word at start)', async () => {
      const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

      // Pure MP3 frame, no ID3 tag
      const mp3Frame = new Uint8Array(288);
      mp3Frame[0] = 0xFF;
      mp3Frame[1] = 0xF2;
      mp3Frame[2] = 0xA4;
      mp3Frame[3] = 0xC0;

      const id3Offset = skipID3v2Tag(mp3Frame);
      expect(id3Offset).toBe(0);

      const syncOffset = findSyncWord(mp3Frame, id3Offset);
      expect(syncOffset).toBe(0);

      // No bytes stripped
      expect(mp3Frame.length - syncOffset).toBe(288);
    });

    it('handles chunks with junk bytes before sync word (no ID3)', async () => {
      const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

      // 5 junk bytes + MP3 frame
      const chunk = new Uint8Array(293);
      chunk[5] = 0xFF;
      chunk[6] = 0xF2;
      chunk[7] = 0xA4;
      chunk[8] = 0xC0;

      const id3Offset = skipID3v2Tag(chunk);
      expect(id3Offset).toBe(0);

      const syncOffset = findSyncWord(chunk, id3Offset);
      expect(syncOffset).toBe(5);

      expect(chunk.length - syncOffset).toBe(288);
    });

    it('falls back to id3Offset when no sync word found', async () => {
      const { findSyncWord, skipID3v2Tag } = await import('./MP3Parser');

      // ID3 tag + no valid sync word after it
      const chunk = new Uint8Array(120);
      chunk[0] = 0x49; // 'I'
      chunk[1] = 0x44; // 'D'
      chunk[2] = 0x33; // '3'
      chunk[3] = 0x02;
      chunk[4] = 0x03;
      chunk[5] = 0x00;
      chunk[6] = 0x00;
      chunk[7] = 0x00;
      chunk[8] = 0x00;
      chunk[9] = 0x64; // size = 100

      const id3Offset = skipID3v2Tag(chunk);
      expect(id3Offset).toBe(110);

      const syncOffset = findSyncWord(chunk, id3Offset);
      expect(syncOffset).toBe(-1);

      // Fallback: use id3Offset
      const audioOffset = syncOffset >= 0 ? syncOffset : id3Offset;
      expect(audioOffset).toBe(110);
      expect(chunk.length - audioOffset).toBe(10); // remaining junk, but at least ID3 is stripped
    });
  });
  ```

**Step 2: Run Test (Red → Green)**
- Command: `npm test src/services/AudioMerger.test.ts`
- Expect: PASS — these tests validate the stripping logic using the exported helpers directly. They don't require implementation changes yet, just confirm the helpers work correctly. If Task 1 is done, these should pass immediately.

**Step 3: Implementation (Green)**
- File: `src/services/AudioMerger.ts`
- Action: Replace `mergeAudioGroupSync` method (lines 220–257) with the two-pass implementation.
  - Add import at top of file: `import { findSyncWord, skipID3v2Tag } from './MP3Parser';`
  - Replace the method body:
    ```typescript
    private async mergeAudioGroupSync(
      audioMap: Map<number, string>,
      group: MergeGroup,
      totalGroups: number,
      tempDirHandle: FileSystemDirectoryHandle
    ): Promise<MergedFile | null> {
      // Pass 1: Read chunks, calculate stripped sizes
      interface ChunkInfo {
        data: Uint8Array;
        audioOffset: number;
      }

      const chunkInfos: ChunkInfo[] = [];
      let totalStrippedSize = 0;

      for (let i = group.fromIndex; i <= group.toIndex; i++) {
        const chunkFilename = audioMap.get(i);
        if (!chunkFilename) continue;

        const data = await this.readChunkFromDisk(chunkFilename, tempDirHandle);
        const id3Offset = skipID3v2Tag(data);
        const syncOffset = findSyncWord(data, id3Offset);
        const audioOffset = syncOffset >= 0 ? syncOffset : id3Offset;

        const strippedLength = data.length - audioOffset;
        if (strippedLength > 0) {
          chunkInfos.push({ data, audioOffset });
          totalStrippedSize += strippedLength;
        }
      }

      if (totalStrippedSize === 0) return null;

      // Pass 2: Allocate exact buffer and copy stripped data
      const combined = new Uint8Array(totalStrippedSize);
      let offset = 0;
      for (const { data, audioOffset } of chunkInfos) {
        const length = data.length - audioOffset;
        combined.set(data.subarray(audioOffset), offset);
        offset += length;
      }

      const filename = this.generateFilename(group, totalGroups, 'mp3');

      return {
        filename,
        blob: new Blob([combined.buffer], { type: 'audio/mpeg' }),
        fromIndex: group.fromIndex,
        toIndex: group.toIndex,
      };
    }
    ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/AudioMerger.test.ts && npm test src/services/pipeline/steps/AudioMergeStep.test.ts`
- Expect: PASS (both new tests and existing step tests)

**Step 5: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 6: Git Commit**
- `git add src/services/AudioMerger.ts src/services/AudioMerger.test.ts && git commit -m "feat: strip MP3 headers in sync merge using two-pass allocation"`

---

### Task 3: Extend dropsContextKeys on AudioMergeStep and SaveStep

**Goal:** Ensure large data structures are deleted from the pipeline context as soon as they're no longer needed.

**Step 1: Write the Failing Tests**
- File: `src/services/pipeline/steps/AudioMergeStep.test.ts`
- Code: Add inside the top-level `describe('AudioMergeStep', ...)`:
  ```typescript
  describe('dropsContextKeys', () => {
    it('declares audioMap, tempDirHandle, and failedTasks as droppable', () => {
      expect(step.dropsContextKeys).toContain('audioMap');
      expect(step.dropsContextKeys).toContain('tempDirHandle');
      expect(step.dropsContextKeys).toContain('failedTasks');
    });
  });
  ```

- File: `src/services/pipeline/steps/SaveStep.test.ts`
- Code: Add inside the top-level `describe('SaveStep', ...)`:
  ```typescript
  describe('dropsContextKeys', () => {
    it('declares assignments, characters, voiceMap, and directoryHandle as droppable', () => {
      expect(step.dropsContextKeys).toContain('assignments');
      expect(step.dropsContextKeys).toContain('characters');
      expect(step.dropsContextKeys).toContain('voiceMap');
      expect(step.dropsContextKeys).toContain('directoryHandle');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts && npm test src/services/pipeline/steps/SaveStep.test.ts`
- Expect: Fail — `tempDirHandle` and `failedTasks` not in AudioMergeStep's `dropsContextKeys`; `voiceMap` and `directoryHandle` not in SaveStep's `dropsContextKeys`.

**Step 3: Implementation (Green)**
- File: `src/services/pipeline/steps/AudioMergeStep.ts` (line 32)
- Action: Change:
  ```typescript
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['audioMap'];
  ```
  to:
  ```typescript
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['audioMap', 'tempDirHandle', 'failedTasks'];
  ```

- File: `src/services/pipeline/steps/SaveStep.ts` (line 22)
- Action: Change:
  ```typescript
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['assignments', 'characters'];
  ```
  to:
  ```typescript
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['assignments', 'characters', 'voiceMap', 'directoryHandle'];
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts && npm test src/services/pipeline/steps/SaveStep.test.ts`
- Expect: PASS

**Step 5: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 6: Git Commit**
- `git add src/services/pipeline/steps/AudioMergeStep.ts src/services/pipeline/steps/AudioMergeStep.test.ts src/services/pipeline/steps/SaveStep.ts src/services/pipeline/steps/SaveStep.test.ts && git commit -m "feat: extend dropsContextKeys for GC of large pipeline data"`

---

### Task 4: Add visibility guard to KeepAwake.startScreenWakeLock

**Goal:** Prevent `navigator.wakeLock.request('screen')` from being called when the tab is hidden (browsers reject this).

**Step 1: Write the Failing Test**
- File: `src/services/KeepAwake.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

  describe('KeepAwake - visibility guard', () => {
    let originalNavigator: Navigator;
    let mockWakeLock: { request: ReturnType<typeof vi.fn> };
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockWakeLock = {
        request: vi.fn().mockResolvedValue({
          released: false,
          release: vi.fn().mockResolvedValue(undefined),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          onrelease: null,
          type: 'screen',
        }),
      };

      // Mock navigator.wakeLock
      Object.defineProperty(navigator, 'wakeLock', {
        value: mockWakeLock,
        configurable: true,
        writable: true,
      });

      addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not request wake lock when document is hidden', async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });

      // Import fresh to get clean state
      const { KeepAwake } = await import('./KeepAwake');
      const keepAwake = new KeepAwake();

      // Trigger just the wake lock part by calling start()
      // The wake lock request should be skipped
      await keepAwake.start();

      expect(mockWakeLock.request).not.toHaveBeenCalled();

      // But the visibility listener should still be registered
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );

      keepAwake.stop();
    });

    it('requests wake lock when document is visible', async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });

      const { KeepAwake } = await import('./KeepAwake');
      const keepAwake = new KeepAwake();

      await keepAwake.start();

      expect(mockWakeLock.request).toHaveBeenCalledWith('screen');

      keepAwake.stop();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/KeepAwake.test.ts`
- Expect: Fail — the "hidden" test fails because `request('screen')` is called unconditionally.

**Step 3: Implementation (Green)**
- File: `src/services/KeepAwake.ts`
- Action: Replace `startScreenWakeLock()` method (lines 89–100) with:
  ```typescript
  private async startScreenWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;

    // Register visibility listener regardless — it will acquire the lock
    // when the tab becomes visible
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Only request if currently visible; browser rejects when hidden
    if (document.visibilityState !== 'visible') return;

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Wake lock not supported or permission denied
    }
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/KeepAwake.test.ts`
- Expect: PASS

**Step 5: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 6: Git Commit**
- `git add src/services/KeepAwake.ts src/services/KeepAwake.test.ts && git commit -m "fix: guard wake lock request behind visibility check"`

---

### Task 5: Create withPermissionRetry utility

**Goal:** Create `src/services/FileSystemRetry.ts` with the `withPermissionRetry` function that catches `NotAllowedError`, notifies the user, re-requests permission, and retries once.

**Step 1: Write the Failing Test**
- File: `src/services/FileSystemRetry.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { withPermissionRetry } from './FileSystemRetry';
  import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

  describe('withPermissionRetry', () => {
    it('returns result on success without retry', async () => {
      const handle = createMockDirectoryHandle();
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withPermissionRetry(handle, operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-NotAllowedError errors', async () => {
      const handle = createMockDirectoryHandle();
      const error = new Error('something else');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(withPermissionRetry(handle, operation)).rejects.toThrow('something else');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries after NotAllowedError when permission re-granted', async () => {
      const handle = {
        ...createMockDirectoryHandle(),
        requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
      } as unknown as FileSystemDirectoryHandle;

      const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
      const operation = vi.fn()
        .mockRejectedValueOnce(notAllowedError)
        .mockResolvedValueOnce('retried-success');

      const result = await withPermissionRetry(handle, operation);

      expect(result).toBe('retried-success');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    });

    it('throws AppError when permission denied on retry', async () => {
      const handle = {
        ...createMockDirectoryHandle(),
        requestPermission: vi.fn().mockResolvedValue('denied' as PermissionState),
        name: 'test-dir',
      } as unknown as FileSystemDirectoryHandle;

      const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
      const operation = vi.fn().mockRejectedValue(notAllowedError);

      await expect(withPermissionRetry(handle, operation)).rejects.toMatchObject({
        code: 'FILE_PERMISSION_DENIED',
      });
    });

    it('calls notify callback when permission is lost', async () => {
      const handle = {
        ...createMockDirectoryHandle(),
        requestPermission: vi.fn().mockResolvedValue('granted' as PermissionState),
      } as unknown as FileSystemDirectoryHandle;

      const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
      const operation = vi.fn()
        .mockRejectedValueOnce(notAllowedError)
        .mockResolvedValueOnce('ok');
      const notify = vi.fn();

      await withPermissionRetry(handle, operation, notify);

      expect(notify).toHaveBeenCalledWith('File system permission lost. Re-requesting access...');
    });

    it('does not call notify when no error occurs', async () => {
      const handle = createMockDirectoryHandle();
      const operation = vi.fn().mockResolvedValue('ok');
      const notify = vi.fn();

      await withPermissionRetry(handle, operation, notify);

      expect(notify).not.toHaveBeenCalled();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/FileSystemRetry.test.ts`
- Expect: Fail — module `./FileSystemRetry` does not exist.

**Step 3: Implementation (Green)**
- File: `src/services/FileSystemRetry.ts` (create new file)
- Code:
  ```typescript
  import { filePermissionError } from '@/errors';

  /**
   * Wraps a File System Access API operation with permission recovery.
   * On NotAllowedError, re-requests permission once, then retries.
   * Shows a notification before re-requesting permission.
   */
  export async function withPermissionRetry<T>(
    directoryHandle: FileSystemDirectoryHandle,
    operation: () => Promise<T>,
    notify?: (message: string) => void
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') {
        throw error;
      }

      // Notify user that permission was lost
      notify?.('File system permission lost. Re-requesting access...');

      const permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw filePermissionError(directoryHandle.name);
      }

      // Single retry after re-grant
      return await operation();
    }
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/FileSystemRetry.test.ts`
- Expect: PASS

**Step 5: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 6: Git Commit**
- `git add src/services/FileSystemRetry.ts src/services/FileSystemRetry.test.ts && git commit -m "feat: add withPermissionRetry utility for File System Access API"`

---

### Task 6: Apply withPermissionRetry to AudioMerger.saveToDirectory and SaveStep

**Goal:** Wrap file system operations in AudioMerger and SaveStep with the permission retry utility.

**Step 1: Write the Failing Test**

No new test file needed — this is a wiring change. The existing tests in `AudioMergeStep.test.ts` and `SaveStep.test.ts` already pass through `createMockDirectoryHandle()` which has `requestPermission` returning `'granted'`. The `withPermissionRetry` wrapper is transparent when no error occurs (verified in Task 5).

Verify existing tests still pass as a baseline:
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts && npm test src/services/pipeline/steps/SaveStep.test.ts`
- Expect: PASS

**Step 2: Implementation**
- File: `src/services/AudioMerger.ts`
- Action:
  1. Add import at top: `import { withPermissionRetry } from './FileSystemRetry';`
  2. Replace `saveToDirectory` method (lines 399–415) with:
     ```typescript
     private async saveToDirectory(
       file: MergedFile,
       directoryHandle: FileSystemDirectoryHandle
     ): Promise<void> {
       await withPermissionRetry(directoryHandle, async () => {
         // Extract folder name from filename (remove extension and part number)
         const folderName = sanitizeFilename(
           file.filename
             .replace(/\s+\d{4}\.(mp3|opus)$/, '')
             .replace(/\.(mp3|opus)$/, '')
         );

         const folderHandle = await directoryHandle.getDirectoryHandle(folderName, { create: true });
         const fileHandle = await folderHandle.getFileHandle(file.filename, { create: true });
         const writableStream = await fileHandle.createWritable();
         await writableStream.write(file.blob);
         await writableStream.close();
       });
     }
     ```

- File: `src/services/pipeline/steps/SaveStep.ts`
- Action:
  1. Add import at top: `import { withPermissionRetry } from '@/services/FileSystemRetry';`
  2. Replace the inner try block (lines 37–55) to wrap FS operations with `withPermissionRetry`:
     ```typescript
     if (directoryHandle && characters && voiceMap && assignments) {
       try {
         const bookName = this.extractBookName(fileNames);
         await withPermissionRetry(directoryHandle, async () => {
           const bookFolder = await directoryHandle.getDirectoryHandle(bookName, { create: true });
           const json = exportToJSONSorted(characters, voiceMap, assignments, this.options.narratorVoice);
           const fileName = `${bookName}.json`;

           const fileHandle = await bookFolder.getFileHandle(fileName, { create: true });
           const writable = await fileHandle.createWritable();
           await writable.write(json);
           await writable.close();
         });
         this.reportProgress(1, 1, `Saved voice mapping: ${bookName}/${bookName}.json`);
       } catch {
         // Non-fatal error - don't fail the whole save if voice mapping fails
         this.reportProgress(1, 1, 'Warning: Could not save voice mapping');
       }
     }
     ```

**Step 3: Verify (Green)**
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts && npm test src/services/pipeline/steps/SaveStep.test.ts`
- Expect: PASS

**Step 4: Typecheck**
- Command: `npm run typecheck`
- Expect: No errors

**Step 5: Full Test Suite**
- Command: `npm test`
- Expect: All tests pass

**Step 6: Git Commit**
- `git add src/services/AudioMerger.ts src/services/pipeline/steps/SaveStep.ts && git commit -m "feat: wrap file system operations with permission retry"`
