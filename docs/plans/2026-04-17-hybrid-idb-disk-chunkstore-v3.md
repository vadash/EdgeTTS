# Hybrid IDB + Disk ChunkStore Implementation Plan (v2)

**Goal:** Replace the single-file append ChunkStore with a hybrid IndexedDB + numbered disk files architecture to eliminate O(N^2) I/O for large book conversions.
**Testing Conventions:** Vitest with JSdom. All external calls and File System API must be mocked. The global `window.indexedDB` mock in `setup.ts` is `configurable` + `writable` — per-test overrides work. When faking IDB request objects, fire `onsuccess` via `queueMicrotask` after returning. Use TDD: failing test first (`npm test -- --run`), minimal implementation, then refactor.

**Cross-tab protection:** Task 7 uses the existing Web Lock (`tts-conversion-active` from `KeepAwake.ts`) to detect and block concurrent conversions across browser tabs. This prevents IDB data corruption from two tabs writing to the shared `edgetts_hybrid_chunks` database simultaneously.

---

### Task 1: IDB Layer — open/close/clear

**Objective:** Create an IDB helper module that opens the `edgetts_hybrid_chunks` database, provides a `chunks` object store keyed by number with Uint8Array values, and supports closing and clearing. This is the foundation all other tasks build on.

**Files to modify/create:**
- Create: `src/services/ChunkIDB.ts` (Purpose: IndexedDB access layer — open, close, getAll, getAllKeys, getChunk, put, deleteKeys, clear)
- Create: `src/services/ChunkIDB.test.ts` (Purpose: unit tests for IDB layer)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/test/setup.ts` to understand the existing `indexedDBMock` shape (line 116). It's `configurable` + `writable` so you can override it per-test.
2. **Write Failing Tests:** In the test file, mock `window.indexedDB` with a fake that simulates `open()`, `transaction()`, `objectStore()`, `put()`, `getAll()`, `delete()`, and `clear()`. Test that:
   - `openDatabase()` opens/creates DB `edgetts_hybrid_chunks` with object store `chunks` using out-of-line keys (no `keyPath` — pass the key number as the second argument to `put`).
   - `putChunk(db, index, data)` stores a Uint8Array keyed by number.
   - `getAllChunks(db)` returns all stored entries as `Array<{key: number, data: Uint8Array}>`.
   - `getAllKeys(db)` returns just the key array `number[]` without fetching payloads — lightweight, used by `flushToDisk` to snapshot current keys.
   - `getChunk(db, key)` returns a single `Uint8Array` for one key — used during flush to stream one chunk at a time instead of bulk-fetching all.
   - `deleteKeys(db, keys: number[])` deletes specific entries.
   - `clearDatabase()` wipes all entries (call `db.transaction('chunks', 'readwrite').objectStore('chunks').clear()`).
   - `closeDatabase(db)` closes the IDB connection.
   - **Important IDB mock pattern:** Each fake request must fire `onsuccess` via `queueMicrotask` after being returned, so Promises wrapping `request.onsuccess` resolve correctly. See `src/test/CLAUDE.md` IndexedDB mock override gotcha.
3. **Implement Minimal Code:** In `ChunkIDB.ts`, export async functions: `openDatabase()`, `putChunk()`, `getAllChunks()`, `getAllKeys()`, `getChunk()`, `deleteKeys()`, `clearDatabase()`, `closeDatabase()`. Keep it procedural — no class needed. The database name is `edgetts_hybrid_chunks`, store name is `chunks`, no secondary indexes. `getAllKeys()` uses `IDBObjectStore.getAllKeys()` (returns `number[]`). `getChunk()` uses `IDBObjectStore.get(key)` (returns `Uint8Array`).
4. **Verify:** Run `npm test -- --run src/services/ChunkIDB.test.ts` and ensure all tests pass.
5. **Commit:** Commit with message: `feat: add ChunkIDB layer for IndexedDB buffer`

---

### Task 2: Rewrite ChunkStore — IDB write path + flush mechanism

**Objective:** Rewrite the `ChunkStore` class to write chunks into IDB instead of appending to a single file. When the IDB buffer reaches 2000 chunks, flush them to numbered disk files (`chunks_data_N.bin` + `chunks_index_N.jsonl`). The public interface remains identical.

**Depends on:** Task 1 (ChunkIDB layer)

**Files to modify/create:**
- Modify: `src/services/ChunkStore.ts` (Purpose: complete rewrite — replace single-file append with IDB buffer + numbered flush files)
- Modify: `src/services/ChunkStore.test.ts` (Purpose: rewrite unit tests for new architecture)
- Modify: `src/services/__tests__/ChunkStore.integration.test.ts` (Purpose: update integration tests for new file naming scheme)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outlines of `src/services/ChunkStore.ts` (current methods: `init`, `cleanupCrswapFiles`, `parseExistingIndex`, `writeChunk`, `drain`, `prepareForRead`, `readChunk`, `getExistingIndices`, `close`) and `src/services/ChunkIDB.ts` (from Task 1). Also read `src/test/mocks/FileSystemMocks.ts` to understand `SharedMockState`, `createMockDirectoryHandle`, and `createMockDirectoryHandleWithState`.
2. **Write Failing Tests:** In `ChunkStore.test.ts`, replace existing tests with tests for the new behavior:
   - `writeChunk` stores data in IDB (mock IDB, verify `putChunk` called).
   - When IDB count reaches `FLUSH_THRESHOLD` (2000), `flushToDisk()` is triggered automatically.
   - `flushToDisk()` creates a new `chunks_data_N.bin` and `chunks_index_N.jsonl` pair (N = incrementing counter starting at 0). It calls `getAllKeys()` to snapshot keys (not `getAllChunks()`), then loops: calls `getChunk(db, key)` per key, writes chunk to data file, builds JSONL index entries `{"i":<chunkIndex>,"o":<byteOffset>,"l":<byteLength>}`, then deletes flushed keys from IDB. Verify that `getAllChunks` is NOT called during flush — only `getAllKeys` + per-key `getChunk`.
   - `prepareForRead()` flushes any remaining IDB chunks to disk, then caches `File` objects for all numbered data files in a `Map<string, File>`.
   - `readChunk(i)` looks up file/offset/length from the RAM index (`Map<number, {file: string, offset: number, length: number}>`), slices from the cached `File` object.
   - `getExistingIndices()` returns the key set of the RAM index — stays synchronous.
   - `clearDatabase()` calls through to `ChunkIDB.clearDatabase()`.
   - `close()` closes the IDB connection.
   - Chunks arriving during an active flush are handled correctly — the flush snapshots current IDB keys, new writes go to IDB and trigger another flush if threshold is hit again after the first completes.
   - **Mock strategy:** Mock `ChunkIDB` functions via `vi.mock('./ChunkIDB')`. Use the existing `MockFileSystem` / `createMockDirectoryHandle` from `FileSystemMocks.ts` for file system operations. The MockFileSystem must support multiple file creation (numbered files).
3. **Implement Minimal Code:** Rewrite `ChunkStore.ts`:
   - Private fields: `directoryHandle`, `ramIndex: Map<number, {file: string, offset: number, length: number}>`, `fileCache: Map<string, File>`, `fileCounter: number`, `flushing: boolean`, `db: IDBDatabase | null`.
   - `init(dirHandle)`: store handle, call `openDatabase()`, call `parseExistingIndex()` (scan numbered index files + IDB contents to rebuild RAM index).
   - `writeChunk(index, data)`: call `putChunk()` into IDB, add RAM index entry with `file: "idb"`. If IDB count >= `FLUSH_THRESHOLD` and not currently flushing, call `flushToDisk()`.
   - `flushToDisk()` (private, async): set `flushing = true`, snapshot IDB keys via `getAllKeys()` (lightweight — no payloads fetched), create new numbered data+index files with `keepExistingData: false`. Then loop: for each key, call `getChunk(db, key)` to pull one `Uint8Array`, write it to the data file, build JSONL index entry, and let the chunk GC. Close both files, call `deleteKeys()` for flushed entries, update RAM index entries from `"idb"` to disk file+offset, increment `fileCounter`, set `flushing = false`. If IDB still has >= `FLUSH_THRESHOLD` after flush, recurse. **Memory discipline:** Never call `getAllChunks()` during flush — always stream one chunk at a time via `getChunk()` to keep RAM flat.
   - `parseExistingIndex()` (private): scan directory for files matching `chunks_index_*.jsonl`, parse each to populate RAM index. Also call `getAllChunks()` from IDB and add those entries to RAM index with `file: "idb"`.
   - `prepareForRead()`: call `flushToDisk()` to flush remaining IDB chunks, then for each unique file in RAM index, get `File` handle and cache it.
   - `readChunk(index)`: look up RAM index, if `file === "idb"` read from IDB directly, otherwise slice from cached `File`.
   - `getExistingIndices()`: return `new Set(this.ramIndex.keys())`.
   - `clearDatabase()`: call `ChunkIDB.clearDatabase()`, clear `ramIndex`.
   - `close()`: call `ChunkIDB.closeDatabase()`, clear caches.
   - **Migration logic in `init()`:** If `chunks_data.bin` (old format) exists in the directory, delete it along with `chunks_index.jsonl`, any `*.crswap`, and any numbered `chunks_data_*.bin` / `chunks_index_*.jsonl` files. Preserve `pipeline_state.json` and `failed_chunks.json`. Then call `clearDatabase()` on IDB. After migration wipe, start fresh (empty RAM index, fileCounter = 0).
   - **Remove:** `dataHandle`, `indexHandle`, `queue`, `drain()`, old single-file append logic, torn-write truncation recovery, `.crswap` cleanup for old file names.
4. **Verify:** Run `npm test -- --run` and ensure all ChunkStore tests pass. Also run `npm test -- --run src/services/__tests__/ChunkStore.integration.test.ts` and fix the integration tests to match the new file naming scheme (numbered files instead of single `chunks_data.bin`).
5. **Commit:** Commit with message: `feat: rewrite ChunkStore with IDB buffer and numbered flush files`

---

### Task 3: Update ResumeCheck — support numbered index files

**Objective:** `ResumeCheck.ts` currently hardcodes `chunks_index.jsonl` (singular) in both `countNewFormatChunks()` and `hasNewFormat()`. After the ChunkStore rewrite produces numbered files (`chunks_index_0.jsonl`, `chunks_index_1.jsonl`, etc.), resume detection will fail — `checkResumeState` will always return `null`, breaking resume entirely. Update these functions to scan for numbered index files instead.

**Depends on:** Task 2 (new ChunkStore defines the numbered file naming scheme)

**Files to modify/create:**
- Modify: `src/services/ResumeCheck.ts` (Purpose: rewrite `hasNewFormat` and `countNewFormatChunks` to scan numbered `chunks_index_N.jsonl` files)
- Modify: `src/services/ResumeCheck.test.ts` (Purpose: update existing tests to use numbered index files, add tests for multi-file scenarios)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the source of these functions in `src/services/ResumeCheck.ts`:
   - `hasNewFormat()` (line 53): currently does `dir.getFileHandle('chunks_index.jsonl')` — returns true if singular file exists.
   - `countNewFormatChunks()` (line 41): currently reads the singular `chunks_index.jsonl` and counts non-empty lines.
   - `checkResumeState()` (line 85): calls both functions and uses the results to decide resume vs fresh start. Also read the test file to understand how `createDirectoryWithFiles` sets up mock directories with specific files.
2. **Write Failing Tests:**
   - `hasNewFormat` returns `true` when `chunks_index_0.jsonl` exists (but `chunks_index.jsonl` does not).
   - `hasNewFormat` returns `true` when `chunks_index_2.jsonl` exists (any numbered variant).
   - `hasNewFormat` returns `false` when no `chunks_index_*.jsonl` files exist.
   - `countNewFormatChunks` sums line counts across multiple numbered index files (e.g., `chunks_index_0.jsonl` has 3 entries, `chunks_index_1.jsonl` has 2 entries → returns 5).
   - `countNewFormatChunks` returns 0 when no numbered index files exist.
   - `checkResumeState` returns correct `cachedChunks` when only numbered files exist (no singular `chunks_index.jsonl`).
   - Update existing tests that set up mock directories with `chunks_index.jsonl` to use `chunks_index_0.jsonl` instead.
3. **Implement Minimal Code:**
   - Rewrite `hasNewFormat()`: iterate `dir.values()`, return `true` if any entry's name matches `/^chunks_index_\d+\.jsonl$/`.
   - Rewrite `countNewFormatChunks()`: iterate `dir.values()`, for each match of `/^chunks_index_\d+\.jsonl$/`, read the file, count non-empty lines, sum across all matches.
   - Both functions must use `for await...of` on `dir.values()` since `FileSystemDirectoryHandle` iteration is async.
   - Remove the old singular-file logic. The old format (`chunks_data.bin` without numbered files) is handled by `hasOldFormat()` which remains unchanged — the `checkResumeState` flow already wipes legacy data via the `hasOld && !hasNew` branch.
4. **Verify:** Run `npm test -- --run src/services/ResumeCheck.test.ts` and ensure all tests pass.
5. **Commit:** Commit with message: `fix: update ResumeCheck to scan numbered chunk index files`

---

### Task 4: Orchestrator integration — clearDatabase on fresh start

**Objective:** Wire up `chunkStore.clearDatabase()` in the Orchestrator so that a fresh conversion wipes stale IDB data, while a resume preserves it.

**Depends on:** Task 2 (new ChunkStore), Task 3 (ResumeCheck must correctly detect numbered files)

**Key architectural fact:** `ChunkStore` is NOT part of `ConversionOrchestratorServices`. It is instantiated locally inside `runTTSStage` at line 811: `const chunkStore = new ChunkStore()`. The cleanest approach is to hoist that instantiation up into `runConversion` so it's available for the clearDatabase call, then pass it into `runTTSStage`.

**Files to modify/create:**
- Modify: `src/services/ConversionOrchestrator.ts` (Purpose: hoist ChunkStore creation to `runConversion`, add `clearDatabase()` call on fresh start, pass instance to `runTTSStage`)
- Modify: `src/services/__tests__/ConversionOrchestrator.test.ts` (Purpose: add test for fresh-start clearDatabase call)
- Modify: `src/services/__tests__/ConversionOrchestrator.resume.test.ts` (Purpose: add test verifying resume does NOT clear IDB)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the source of `runConversion` (line 399) and `runTTSStage` (line 797) in `src/services/ConversionOrchestrator.ts`. Specifically:
   - `runTTSStage` creates `const chunkStore = new ChunkStore()` at line 811, then calls `chunkStore.init(tempDirHandle)` at line 814.
   - `runConversion` calls `checkResumeState` and branches on the result. The TTS stage is invoked via `runTTSStage(...)` somewhere after the resume decision.
   - The `audioMergerFactory.create()` receives `{ chunkStore }` — so ChunkStore is already passed downstream from `runTTSStage`.
   Also read `src/services/__tests__/ConversionOrchestrator.test.ts` to understand `createMockServices()` and how the orchestrator is tested.
2. **Write Failing Tests:**
   - In `ConversionOrchestrator.test.ts`: Add a test that verifies on a **fresh start** (when `checkResumeState` returns `null`), `ChunkStore.prototype.clearDatabase` (or the instance's `clearDatabase`) is called before the TTS stage begins. Use `vi.spyOn(ChunkStore.prototype, 'clearDatabase')` to track the call.
   - In `ConversionOrchestrator.resume.test.ts`: Add a test that verifies on a **resume** (when `checkResumeState` returns non-null), `clearDatabase` is **not** called — IDB data is preserved.
3. **Implement Minimal Code:**
   - In `runConversion`, **before** the resume branch: `const chunkStore = new ChunkStore()`.
   - After `checkResumeState` returns `null` (fresh start branch): call `await chunkStore.clearDatabase()`.
   - Pass `chunkStore` as a new parameter to `runTTSStage(...)`.
   - In `runTTSStage`, remove the local `const chunkStore = new ChunkStore()` and use the passed-in parameter instead. Keep the `chunkStore.init(tempDirHandle)` call where it is.
   - `ChunkStore` still does NOT go into `ConversionOrchestratorServices` — it's a direct dependency of `runConversion`, not an injectable service.
4. **Verify:** Run `npm test -- --run` and ensure all ConversionOrchestrator tests pass, including the new ones.
5. **Commit:** Commit with message: `feat: call chunkStore.clearDatabase() on fresh conversion start`

---

### Task 5: Update downstream consumers and test mocks

**Objective:** Ensure all test files that reference the old ChunkStore file naming scheme (`chunks_data.bin`, `chunks_index.jsonl`) are updated to work with the new numbered scheme, and that TTSWorkerPool / AudioMerger integration still works.

**Depends on:** Task 2 (new ChunkStore)

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.test.ts` (Purpose: update any ChunkStore mock references)
- Modify: `src/services/TTSWorkerPool.ladder.test.ts` (Purpose: update any ChunkStore mock references)
- Modify: `src/services/TTSWorkerPool.retry.integration.test.ts` (Purpose: update any ChunkStore mock references)
- Modify: `src/services/integration/ladder-integration.test.ts` (Purpose: update any ChunkStore mock references)

**Instructions for Execution Agent:**
1. **Context Setup:** Search each test file listed above for references to `ChunkStore` mocking, `chunks_data.bin`, `chunks_index.jsonl`, or `mockChunkStore`. Understand how the mock is structured — these tests likely mock `writeChunk`, `readChunk`, `getExistingIndices`, etc. via `vi.fn()`.
2. **Write Failing Tests:** Not applicable — these are mock updates, not new tests. Instead, update the mock shapes if `ChunkStore`'s public interface changed (it shouldn't per the design — same public methods). If any test asserts on internal file names (e.g., checking that `chunks_data.bin` was created), update those assertions to match the new numbered naming scheme.
3. **Implement Minimal Code:** Update mock `ChunkStore` implementations in these test files to include the new `clearDatabase()` method as a no-op `vi.fn()`. The rest of the public interface (`init`, `writeChunk`, `prepareForRead`, `readChunk`, `getExistingIndices`, `close`) is unchanged — no modifications needed unless a test was asserting on internal implementation details.
4. **Verify:** Run `npm test -- --run` and ensure ALL tests pass across the entire suite.
5. **Commit:** Commit with message: `fix: update downstream test mocks for hybrid ChunkStore`

---

### Task 6: Update shared FileSystemMocks for numbered file support

**Objective:** Ensure the shared `FileSystemMocks` in `src/test/mocks/FileSystemMocks.ts` supports the numbered file pattern (`chunks_data_0.bin`, `chunks_index_0.jsonl`, etc.) correctly. The mock must handle `getFileHandle` with `create: true` for arbitrary numbered filenames and `removeEntry` for migration cleanup.

**Depends on:** Task 2 (new ChunkStore — tests will reveal if mocks need changes)

**Files to modify/create:**
- Modify: `src/test/mocks/FileSystemMocks.ts` (Purpose: ensure `SharedMockState` supports dynamic numbered file creation and deletion)
- Modify: `src/test/mocks/FileSystemMocks.test.ts` (Purpose: test that mocks work with numbered files — create this only if no existing test file)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/test/mocks/FileSystemMocks.ts` — understand `SharedMockState`, `createMockDirectoryHandleWithState`, and `createMockDirectoryHandle`. Check if the existing mock `getFileHandle` with `create: true` already works for arbitrary filenames (it likely does since it stores files in a `Map`).
2. **Write Failing Tests:** Test that `createMockDirectoryHandle` can create files named `chunks_data_0.bin`, `chunks_data_1.bin`, `chunks_index_0.jsonl` etc. Test that `removeEntry` deletes them. Test that iterating via `entries()` lists all numbered files. If these already pass, skip this step.
3. **Implement Minimal Code:** Only if tests fail — update the mock to support the needed operations. The mock likely already handles this via a generic `Map<string, Uint8Array>`, but verify.
4. **Verify:** Run `npm test -- --run` and ensure all tests pass.
5. **Commit:** Commit with message: `fix: ensure FileSystemMocks supports numbered chunk files`

---

### Task 7: Cross-tab conversion blocking via Web Lock

**Objective:** Prevent users from accidentally running two conversions in parallel across browser tabs. The shared IDB database `edgetts_hybrid_chunks` would be corrupted by concurrent writes. The app already holds an exclusive Web Lock (`tts-conversion-active`) during conversion via `KeepAwake.ts` (line 77). Query that same lock at conversion start to detect and block a second tab.

**Depends on:** None — this is independent of the ChunkStore rewrite tasks

**Files to modify/create:**
- Modify: `src/services/KeepAwake.ts` (Purpose: add a static `isConversionRunning()` method that queries `navigator.locks.query()` for the `tts-conversion-active` lock)
- Modify: `src/services/KeepAwake.test.ts` (Purpose: test `isConversionRunning` with mocked `navigator.locks`)
- Modify: `src/hooks/useTTSConversion.ts` (Purpose: check `isConversionRunning()` before starting conversion, set a signal if blocked)
- Modify: `src/stores/ConversionStore.ts` (Purpose: add `tabBlocked: boolean` to `ConversionState`, default `false`)
- Modify: UI component that shows conversion controls (Purpose: display banner when `tabBlocked` is true)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/services/KeepAwake.ts` — the `startWebLock()` method (line 73) requests `navigator.locks.request('tts-conversion-active', { mode: 'exclusive' }, ...)`. The lock is held for the entire conversion duration and released in `stop()`. Read `src/hooks/useTTSConversion.ts` — the `startConversion` callback (around line 120) is where the conversion begins. Read `src/stores/ConversionStore.ts` — the `ConversionState` interface and `conversion` signal.
2. **Write Failing Tests:**
   - In `KeepAwake.test.ts`: Test `isConversionRunning()` returns `true` when `navigator.locks.query()` shows `tts-conversion-active` held. Test it returns `false` when the lock is not held. Test it returns `false` when `navigator.locks` is unavailable (fallback). Mock `navigator.locks.query` to return `{ held: [{ name: 'tts-conversion-active' }] }` vs `{ held: [] }`.
   - In `useTTSConversion.test.ts` (or the appropriate test file for the hook): Test that calling `startConversion` when `isConversionRunning()` returns `true` sets `conversion.value.tabBlocked = true` and does NOT start the conversion.
3. **Implement Minimal Code:**
   - In `KeepAwake.ts`, add a static async method `isConversionRunning(): Promise<boolean>`:
     ```ts
     static async isConversionRunning(): Promise<boolean> {
       if (!navigator.locks) return false;
       const state = await navigator.locks.query();
       return state.held?.some(lock => lock.name === 'tts-conversion-active') ?? false;
     }
     ```
   - In `ConversionStore.ts`, add `tabBlocked: boolean` to `ConversionState` (default `false`).
   - In `useTTSConversion.ts`, at the top of the `startConversion` callback (before `keepAwake.start()`), call `const blocked = await KeepAwake.isConversionRunning()`. If `blocked`, set `patchState({ tabBlocked: true, status: 'idle' })` and return early. Clear `tabBlocked` on any subsequent conversion attempt or when the user dismisses it.
   - In the UI component that renders conversion controls, show a dismissible banner: "A conversion is already running in another tab. Close this tab or wait for it to finish." when `conversion.value.tabBlocked === true`.
4. **Verify:** Run `npm test -- --run` and ensure all tests pass.
5. **Commit:** Commit with message: `feat: block concurrent conversions across browser tabs via Web Lock`
