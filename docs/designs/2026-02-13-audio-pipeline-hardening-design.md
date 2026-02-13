# Design: Audio Pipeline Hardening (Items 1, 2, 4, 5)

**Date:** 2026-02-13
**Status:** Design Complete
**Target:** AudioMerger, MP3Parser, KeepAwake, FileSystem permission handling

## 1. Problem Statement

Four independent issues affect reliability and memory efficiency in the audio pipeline:

1. **MP3 Header Duplication:** `mergeAudioGroupSync()` concatenates raw MP3 chunks including ID3v2 tags and junk bytes before the first sync word. This bloats output and can cause player glitches.
2. **Context Memory Leak:** Large data structures (`audioMap`, `assignments`, `tempDirHandle`, `failedTasks`) survive in the pipeline context longer than needed, delaying GC.
3. **Wake Lock Failure on Hidden Tabs:** `startScreenWakeLock()` calls `navigator.wakeLock.request('screen')` unconditionally. Browsers reject this when `document.visibilityState !== 'visible'`, producing a silent error.
4. **Permission Loss During Save:** File System Access API permissions can be revoked mid-operation (tab backgrounding, user action). No recovery mechanism exists — the operation fails permanently.

## 2. Goals & Non-Goals

### Must Do
- Strip ID3v2 tags and pre-sync junk from every MP3 chunk during sync merge
- Use two-pass allocation to minimize peak memory (exact buffer size)
- Extend `dropsContextKeys` on `AudioMergeStep` and `SaveStep` to cover all large fields no longer needed
- Guard wake lock request behind visibility check
- Add `withPermissionRetry()` utility for File System Access API operations
- Show user notification when permission is lost and re-requested

### Won't Do
- Change async (FFmpeg) merge path — only sync MP3 concatenation is affected
- Add wake lock retry logic beyond existing `handleVisibilityChange` handler
- Retry more than once on permission failure (single retry after re-request)
- Cache or persist file system permissions across sessions

## 3. Proposed Architecture

### Item 1: MP3 Header Stripping in Sync Merge

**Files:** `src/services/MP3Parser.ts`, `src/services/AudioMerger.ts`

#### 3.1.1 Export helpers from MP3Parser

`findSyncWord` (line 91) and `skipID3v2Tag` (line 217) are currently module-private. Export both.

```typescript
// MP3Parser.ts — add export keyword
export function findSyncWord(buffer: Uint8Array, startOffset: number): number { ... }
export function skipID3v2Tag(buffer: Uint8Array): number { ... }
```

#### 3.1.2 Two-pass merge in mergeAudioGroupSync

Replace the current single-pass concatenation (lines 220–257) with:

**Pass 1 — Calculate offsets and stripped sizes:**

```typescript
interface ChunkInfo {
  data: Uint8Array;
  audioOffset: number; // byte offset where actual audio frames start
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

  chunkInfos.push({ data, audioOffset });
  totalStrippedSize += data.length - audioOffset;
}
```

**Pass 2 — Allocate exact buffer and copy:**

```typescript
if (totalStrippedSize === 0) return null;

const combined = new Uint8Array(totalStrippedSize);
let offset = 0;
for (const { data, audioOffset } of chunkInfos) {
  const length = data.length - audioOffset;
  combined.set(data.subarray(audioOffset), offset);
  offset += length;
}
```

**Note:** All chunk headers are stripped, including the first chunk. The resulting file is a raw MP3 frame stream — standard players handle this correctly.

**Edge case:** If `findSyncWord` returns `-1` (no valid frame found), fall back to `id3Offset`. This handles edge cases where chunks contain only metadata.

### Item 2: Pipeline Context Cleanup via dropsContextKeys

**Files:** `src/services/pipeline/steps/AudioMergeStep.ts`, `src/services/pipeline/steps/SaveStep.ts`

The pipeline runner already deletes keys listed in `dropsContextKeys` after each step executes (PipelineRunner.ts:68–72). Extend the existing declarations:

**AudioMergeStep** (currently drops `['audioMap']`):

```typescript
// AudioMergeStep.ts line 32
readonly dropsContextKeys: (keyof PipelineContext)[] = [
  'audioMap',
  'tempDirHandle',
  'failedTasks',
];
```

Rationale: After merge completes, temp chunk files and the temp directory handle are no longer needed. `failedTasks` was only used for gap detection during merge.

**SaveStep** (currently drops `['assignments', 'characters']`):

```typescript
// SaveStep.ts line 22
readonly dropsContextKeys: (keyof PipelineContext)[] = [
  'assignments',
  'characters',
  'voiceMap',
  'directoryHandle',
];
```

Rationale: SaveStep is the final step. After it runs, all remaining large fields (`voiceMap`, `directoryHandle`) are no longer needed. The runner deletes them from the context object, making them GC-eligible.

### Item 4: KeepAwake Visibility Guard

**File:** `src/services/KeepAwake.ts`

Modify `startScreenWakeLock()` (line 89) to check visibility before requesting:

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

Key change: The `visibilitychange` listener is registered **before** the early return. The existing `handleVisibilityChange` (line 102) already checks `!this.wakeLock` and re-acquires, so it will pick up the lock when the tab becomes visible.

The `cleanup()` method already calls `document.removeEventListener('visibilitychange', this.handleVisibilityChange)`, so the early-registered listener is properly cleaned up.

### Item 5: FileSystem Handle Permission Recovery

**New file:** `src/services/FileSystemRetry.ts`
**Modified files:** `src/services/AudioMerger.ts`, `src/services/pipeline/steps/SaveStep.ts`

#### 3.5.1 Utility function

```typescript
// src/services/FileSystemRetry.ts
import { AppError, filePermissionError } from '@/errors';

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

#### 3.5.2 Apply in AudioMerger.saveToDirectory (line 399)

```typescript
private async saveToDirectory(
  file: MergedFile,
  directoryHandle: FileSystemDirectoryHandle
): Promise<void> {
  await withPermissionRetry(directoryHandle, async () => {
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

#### 3.5.3 Apply in SaveStep.execute (line 37–55)

Wrap the directory/file operations inside the existing try block with `withPermissionRetry`:

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
    this.reportProgress(1, 1, 'Warning: Could not save voice mapping');
  }
}
```

**Notification plumbing:** The `notify` callback can be wired through the pipeline progress mechanism or left as `undefined` initially — the retry still works without it. A follow-up can connect it to the toast system.

## 4. Data Models / Schema

No new persistent data models. Changes are limited to:

- `ChunkInfo` — ephemeral struct within `mergeAudioGroupSync`, not exported
- `withPermissionRetry<T>` — generic utility, no schema

## 5. Interface / API Design

### New exports from MP3Parser.ts

```typescript
export function findSyncWord(buffer: Uint8Array, startOffset: number): number;
export function skipID3v2Tag(buffer: Uint8Array): number;
```

### New module: FileSystemRetry.ts

```typescript
export function withPermissionRetry<T>(
  directoryHandle: FileSystemDirectoryHandle,
  operation: () => Promise<T>,
  notify?: (message: string) => void
): Promise<T>;
```

### Modified dropsContextKeys

| Step | Current drops | New drops |
|------|--------------|-----------|
| `AudioMergeStep` | `audioMap` | `audioMap`, `tempDirHandle`, `failedTasks` |
| `SaveStep` | `assignments`, `characters` | `assignments`, `characters`, `voiceMap`, `directoryHandle` |

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| **Chunk with no sync word** (corrupt/empty MP3) | `findSyncWord` returns `-1`; fall back to `id3Offset`, copying from after ID3 tag. If entire chunk is junk, `length - audioOffset` could be 0 — skip it. |
| **First frame not at sync word** (false positive sync pattern in ID3 data) | `skipID3v2Tag` runs first, narrowing the search window past the tag. False positives in raw audio data are statistically rare (11 consecutive set bits). |
| **requestPermission() blocked by browser** | Some browsers only allow `requestPermission()` from a user gesture. If called outside a gesture context, it may throw. The catch block in `withPermissionRetry` converts this to `filePermissionError`. |
| **Wake lock listener registered but never cleaned up on error** | `cleanup()` always removes the listener. The listener is registered unconditionally now, but cleanup is also unconditional. |
| **dropsContextKeys deletes field still needed by pause callback** | SaveStep is always the last step. AudioMergeStep drops `tempDirHandle` after merge — no subsequent step reads temp chunks. The pause callback (between voice-assignment and TTS) runs before these steps. |
| **Two-pass holds all chunks in memory simultaneously** | Same as current behavior — chunks are already all held in `chunks[]` array. The two-pass approach adds only the `ChunkInfo` wrapper overhead (~16 bytes per chunk for the offset field). |
