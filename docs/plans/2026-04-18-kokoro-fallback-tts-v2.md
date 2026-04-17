# Kokoro Fallback TTS Implementation Plan

**Goal:** When Edge TTS permanently fails a chunk (5 retries exhausted), automatically synthesize it using Kokoro (local ONNX TTS) instead of inserting silence.
**Testing Conventions:** Vitest-based. All external network, File System API, and WebSockets must be mocked. `p-retry`, `p-queue`, and `generic-pool` are mocked globally in `src/test/setup.ts` to execute immediately. Call `localStorage.clear()` in `beforeEach()`.

**Review Notes (v2):**
- **Task 1:** WAV encoding must be strictly little-endian (`true` as 2nd arg to all `DataView.setInt*` calls).
- **Task 2:** `dispose()` must handle in-flight syntheses — either await pending or reject them via AbortController. `initPromise` must be cleared on dispose.
- **Task 3:** Hard-split fallback for >300 char strings that lack punctuation (split on spaces/commas).
- **Task 4:** NPM package is `kokoro-js` — NOT `@huggingface/transformers`. The `kokoro-js` package provides the `KokoroTTS.from_pretrained()` API directly. The `@huggingface/transformers` approach uses lower-level APIs (`StyleTextToSpeech2Model`, `AutoTokenizer`) which is a different integration pattern. Keeping `kokoro-js` as designed.
- **Task 5:** `PoolTask` interface needs `gender?: 'male' | 'female' | 'unknown'` field. `ConversionOrchestrator.runTTSStage` must propagate gender from `LLMCharacter`. Synthesize returns `Blob` but `ChunkStore.writeChunk` expects `Uint8Array` — use `new Uint8Array(await blob.arrayBuffer())`.

---

### Task 1: PCM-to-WAV Utility

**Objective:** Create a standalone `encodeWav` function that converts raw PCM `Float32Array` data into a WAV `Blob`. This utility is needed by `KokoroFallbackService` to transcode Kokoro's raw PCM output before FFmpeg conversion.

**Files to modify/create:**
- Create: `src/services/audio/encodeWav.ts` (Purpose: Float32Array PCM → WAV Blob encoder with RIFF header)
- Test: `src/services/audio/encodeWav.test.ts`

**Instructions for Execution Agent:**
1. **Context Setup:** This is a new directory and file. No existing code to read.
2. **Write Failing Test:** In the test file, write tests that verify:
   - A `Float32Array` of silence (all zeros) produces a valid WAV blob (correct RIFF header magic bytes `RIFF`/`WAVE`, correct fmt chunk, correct data size).
   - The function accepts a `sampleRate` parameter and embeds it in the fmt chunk.
   - A `Float32Array` with actual audio data (non-zero samples) produces a blob whose byte length matches: 44 (header) + `float32Array.length * 2` (16-bit PCM samples).
   - Edge case: empty `Float32Array` (zero-length) still produces a valid WAV with data size 0.
3. **Implement Minimal Code:** Create `encodeWav(pcmData: Float32Array, sampleRate: number): Blob`. Write a standard 44-byte RIFF/WAV header (mono, 16-bit PCM, **strictly little-endian** — always pass `true` as the second argument to `DataView.prototype.setInt16`/`setInt32`/`setUint16`/`setUint32` since the WAV spec requires little-endian byte order). Convert float samples to Int16 by clamping to [-1, 1] and multiplying by 32767. Use `DataView` for header, `Int16Array` for samples, combine into a single `Blob`.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add encodeWav utility for PCM Float32 to WAV conversion`

---

### Task 2: KokoroFallbackService — Singleton Core and Preload

**Objective:** Create the `KokoroFallbackService` singleton class with `getInstance()`, `preload()`, `ensureReady()`, and `dispose()` methods. The service manages a Web Worker lifecycle and model loading. This task does NOT yet implement `synthesize()` — only the init/preload/dispose lifecycle.

**Depends on:** Task 1 (will import `encodeWav` later in Task 3, but this task is independent)

**Files to modify/create:**
- Create: `src/services/KokoroFallbackService.ts` (Purpose: Singleton service managing Kokoro Web Worker lifecycle)
- Test: `src/services/KokoroFallbackService.test.ts`

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/FFmpegService.ts` to understand the constructor pattern (`new FFmpegService(logger?)`). This service will create its own isolated `new FFmpegService()` instance.
2. **Write Failing Test:** Mock the `Worker` constructor globally. Write tests that verify:
   - `getInstance()` returns the same instance on repeated calls (singleton pattern).
   - `preload()` creates a worker and posts a `load` message. Calling `preload()` again while loading returns the same promise (idempotent — no second worker created).
   - When the worker responds with `{ type: 'ready' }`, the `ready` getter returns `true`.
   - `dispose()` terminates the worker and resets state so `ready` is `false`. After dispose, `getInstance()` returns a fresh instance.
   - Inactivity timeout: after 5 minutes of inactivity (use fake timers), `dispose()` is called automatically. Call `preload()` to init, advance time by 5 minutes, verify worker was terminated.
   - `preload()` failure: if the worker posts `{ type: 'error', message }`, the promise rejects and `ready` remains `false`.
   - `dispose()` during active synthesis: call `dispose()` while a `generate` message is in-flight. Verify that the pending synthesis promise rejects gracefully (does not leave the service in a broken state), and that `initPromise` is cleared so a subsequent `preload()` starts fresh (not stuck on the old rejected promise).
3. **Implement Minimal Code:** Create `KokoroFallbackService` class with:
   - `private static instance` and `static getInstance()`.
   - `private worker: Worker | null`, `private initPromise: Promise<void> | null`, `private _ready: boolean`, `private lastUsedAt`, `private inactivityTimer`, `private pendingSyntheses: Set<Promise<unknown>>` (tracks in-flight synthesis calls).
   - `preload()`: idempotent — if `initPromise` exists, return it. Otherwise create worker, set up `onmessage`/`onerror` handlers, store the promise.
   - `private ensureReady()`: calls `preload()` if not ready.
   - `private resetInactivityTimer()`: clears old timer, sets 5-min `setTimeout` calling `dispose()`.
   - `dispose()`: **if `pendingSyntheses` is non-empty, await `Promise.allSettled(pendingSyntheses)` before terminating** (or reject them immediately via an `AbortController`-like mechanism — either approach is valid, but the agent must pick one and handle it). Then terminate worker, clear `initPromise`, null state, clear timer. Must not leave `initPromise` pointing to a stale promise.
   - `get ready(): boolean`.
   - Define `KOKORO_CONFIG` constant with model ID, dtype, device, voices map, maxChunkChars, timeouts.
   - Do NOT implement `synthesize()` yet (that's Task 3).
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add KokoroFallbackService singleton with preload/dispose lifecycle`

---

### Task 3: KokoroFallbackService — Synthesize Method

**Objective:** Implement the `synthesize(text, gender)` method on `KokoroFallbackService`. This handles: lazy init, gender-to-voice mapping, long-text splitting, worker communication (generate → PCM Float32Array), PCM-to-WAV encoding, and WAV-to-MP3 transcoding via a dedicated FFmpegService instance.

**Depends on:** Task 1, Task 2

**Files to modify/create:**
- Modify: `src/services/KokoroFallbackService.ts` (Purpose: Add `synthesize()` method and long-text splitting logic)
- Modify: `src/services/KokoroFallbackService.test.ts` (Purpose: Add synthesize tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/KokoroFallbackService.ts` (from Task 2) and `src/services/FFmpegService.ts` to understand the `load()` and `processAudio()` signatures. Read the outline of `src/services/audio/encodeWav.ts` (from Task 1).
2. **Write Failing Test:** Add tests to the existing test file that verify:
   - `synthesize('Hello', 'female')` sends a `generate` message to the worker with `{ text: 'Hello', voice: 'af_heart' }`, receives back PCM `Float32Array`, encodes to WAV, transcodes via dedicated FFmpeg to MP3, returns a Blob. The shared FFmpeg singleton (`getFFmpeg()`) is never called.
   - Voice mapping: `'male'` → `'am_fenrir'`, `'female'` → `'af_heart'`, `'unknown'` → `'af_heart'`.
   - Long text (>300 chars): text is split on sentence boundaries (`.!?`), each sub-chunk sent to worker separately, PCM Float32Arrays concatenated, then single WAV encode and MP3 transcode.
   - Synthesis timeout: if worker does not respond within 20 seconds (fake timers), the promise rejects and the chunk is treated as failed.
   - Worker crash during synthesis: error is caught, does not leave service in broken state (next call can retry).
   - `resetInactivityTimer()` is called after each successful synthesis.
   - Dedicated FFmpeg: the service creates its own `new FFmpegService()` (not the shared singleton). This FFmpeg instance is terminated in `dispose()`.
3. **Implement Minimal Code:** Add to `KokoroFallbackService`:
   - `private ffmpeg: FFmpegService` field — instantiated in constructor or lazily.
   - `async synthesize(text: string, gender: 'male' | 'female' | 'unknown'): Promise<Blob>`:
     - Await `ensureReady()`.
     - Map gender to voice via `KOKORO_CONFIG.voices`.
     - If `text.length > MAX_CHUNK_CHARS`: split on sentence boundaries (`/(?<=[.!?])\s+/`), group sub-chunks to stay under 300 chars each. **Hard-split fallback:** if any individual sub-chunk still exceeds 300 chars (e.g., text with no punctuation), fall back to splitting on spaces or commas to ensure no chunk exceeds the model's context limit.
     - For each sub-chunk (or the whole text if short): post `generate` message to worker, await PCM response wrapped in `Promise.race` with 20s timeout.
     - Concatenate all PCM `Float32Array` chunks.
     - Call `encodeWav(concatenatedPcm, sampleRate)` to get WAV Blob.
     - Ensure dedicated FFmpeg is loaded, transcode WAV to MP3 (24kHz, 96kbps, mono).
     - Reset inactivity timer.
     - Return MP3 Blob.
   - Helper `private generateSingle(text: string, voice: string): Promise<Float32Array>` — posts to worker, returns PCM.
   - Helper `private splitLongText(text: string): string[]` — sentence-boundary splitting with hard-split fallback for chunks >300 chars that lack punctuation.
   - Update `dispose()` to also terminate the dedicated FFmpeg instance.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: implement KokoroFallbackService.synthesize with long-text splitting and MP3 transcode`

---

### Task 4: Kokoro Web Worker

**Objective:** Create the `kokoro.worker.ts` Web Worker that loads the Kokoro ONNX model and handles `generate` messages, returning raw PCM `Float32Array` data.

**Depends on:** Nothing (can be developed in parallel with Tasks 1-3)

**Files to modify/create:**
- Create: `src/services/workers/kokoro.worker.ts` (Purpose: Web Worker for ONNX inference using `kokoro-js` library)
- Test: `src/services/workers/kokoro.worker.test.ts`

**Instructions for Execution Agent:**
1. **Context Setup:** Check if `kokoro-js` (or `@huggingface/kokoro-js`) is already in `package.json` dependencies. If not, note that it needs to be installed. This worker uses `KokoroTTS.from_pretrained()` from that library.
2. **Write Failing Test:** Testing a Web Worker requires mocking `self.onmessage`/`self.postMessage`. Write tests that verify:
   - On receiving `{ type: 'load', modelId, dtype }`, the worker calls `KokoroTTS.from_pretrained(modelId, { dtype, device: 'wasm' })`, then posts `{ type: 'ready' }`.
   - On receiving `{ type: 'generate', text, voice }`, the worker calls `tts.generate(text, { voice })`, then posts `{ type: 'audio', pcmData: Float32Array, sampleRate: number }`. Verify the posted data is a `Float32Array` (not a WAV blob).
   - On model load failure, the worker posts `{ type: 'error', message: string }`.
   - On generate failure, the worker posts `{ type: 'error', message: string }`.
   - Mock `KokoroTTS` entirely — no real model loading in tests.
3. **Implement Minimal Code:** Create the worker file:
   - Import `KokoroTTS` from `kokoro-js` (or the correct package name — verify via npm).
   - Use `self.onmessage` handler with a switch on `message.data.type`.
   - `load`: call `KokoroTTS.from_pretrained()`, store the instance, post `ready`.
   - `generate`: call `tts.generate(text, { voice })`, extract raw audio data, post as `Float32Array` with `sampleRate`.
   - Error handling: wrap each handler in try/catch, post `error` on failure.
   - Use `self.postMessage({ type: 'audio', pcmData, sampleRate }, [pcmData.buffer])` to transfer (zero-copy) the ArrayBuffer.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: add kokoro.worker.ts for ONNX TTS inference in Web Worker`

---

### Task 5: TTSWorkerPool Integration — Preload Trigger and Fallback on Exhaustion

**Objective:** Modify `TTSWorkerPool.handleTaskFailure()` to: (1) trigger `KokoroFallbackService.preload()` when a chunk hits retry attempt #2, and (2) after all 5 retries are exhausted, call `kokoroFallback.synthesize()` and save the MP3 result to ChunkStore instead of marking the task failed with silence.

**Depends on:** Task 2, Task 3

**Files to modify/create:**
- Modify: `src/services/TTSWorkerPool.ts` (Purpose: Add Kokoro fallback integration points in `handleTaskFailure`)
- Modify: `src/services/TTSWorkerPool.test.ts` (Purpose: Add tests for preload trigger and fallback synthesis)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/services/TTSWorkerPool.ts`, focusing on `handleTaskFailure` (line 348) and `PoolTask` interface (line 12). Read the outline of `src/services/KokoroFallbackService.ts` to understand the `preload()` and `synthesize()` signatures.
2. **Write Failing Test:** Add tests to the existing test file that verify:
   - **Preload trigger:** When a task fails with attempt === 2, `KokoroFallbackService.getInstance().preload()` is called. Mock the service and verify `preload` was invoked.
   - **No premature preload:** When attempt === 1, `preload()` is NOT called.
   - **Fallback synthesis:** When a task fails with attempt > 5, `kokoroFallback.synthesize(task.text, task.gender)` is called. If it succeeds, the returned Blob is converted to `Uint8Array` via `new Uint8Array(await blob.arrayBuffer())` and written to ChunkStore via `writeChunk(task.partIndex, data)`, and the task is NOT added to `failedTasks`.
   - **Fallback failure passthrough:** When `synthesize()` throws, the task IS added to `failedTasks` (existing silence behavior preserved).
   - **Gender propagation:** The `PoolTask` interface must carry a `gender` field. The agent must update the `PoolTask` interface to include `gender?: 'male' | 'female' | 'unknown'`, and update `ConversionOrchestrator.ts` (in `runTTSStage`) to propagate gender from the `LLMCharacter` list when building PoolTask items.
3. **Implement Minimal Code:**
   - Import `KokoroFallbackService` at the top of `TTSWorkerPool.ts`.
   - In the constructor or as a field, store a reference: `private kokoroFallback = KokoroFallbackService.getInstance()`.
   - **Update `PoolTask` interface** to include `gender?: 'male' | 'female' | 'unknown'`.
   - **Update `ConversionOrchestrator.ts`** `runTTSStage` to map gender from `LLMCharacter` (which has `gender: 'male' | 'female' | 'unknown'`) into each PoolTask when building chunk items.
   - In `handleTaskFailure()`:
     - Add `if (task.attempt === 2) { this.kokoroFallback.preload(); }` — fire-and-forget (no await, non-blocking).
     - After the existing retry-exhausted check (`attempt > maxRetries`): instead of immediately calling `markFailed(task)`, try `this.kokoroFallback.synthesize(task.text, task.gender ?? 'unknown')`. On success, convert the Blob to `Uint8Array` via `new Uint8Array(await blob.arrayBuffer())` and call `this.chunkStore.writeChunk(task.partIndex, data)`. On failure, fall through to existing `markFailed(task)` + `logTTSFailure()`.
4. **Verify:** Run the tests and ensure they pass.
5. **Commit:** Commit with message: `feat: integrate Kokoro fallback into TTSWorkerPool retry and failure handling`

---

### Task 6: Webpack Configuration — ONNX Runtime WASM Assets

**Objective:** Update `webpack.config.js` to bundle ONNX Runtime WASM files so they are available at runtime for Kokoro inference.

**Depends on:** Task 4 (worker references ONNX Runtime)

**Files to modify/create:**
- Modify: `webpack.config.js` (Purpose: Add CopyPlugin pattern for ONNX Runtime WASM binaries)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `webpack.config.js` to find the existing `CopyPlugin` configuration.
2. **Write Failing Test:** No test file for webpack config. Instead, verify the build:
   - After modification, run `npx webpack --mode production` (or the project's build command) and confirm no errors.
   - Verify that `*.wasm` files from `onnxruntime-web/dist/` appear in the output directory.
3. **Implement Minimal Code:** Add a new pattern to the existing `CopyPlugin` patterns array:
   - `from: 'node_modules/onnxruntime-web/dist/*.wasm'`, `to: '[name][ext]'`.
   - Do NOT add `coi-serviceworker` — single-threaded WASM does not require cross-origin isolation.
4. **Verify:** Run the build and confirm WASM files are copied to dist.
5. **Commit:** Commit with message: `feat: bundle ONNX Runtime WASM files via webpack CopyPlugin`

---

### Task 7: KokoroTestButton UI Component

**Objective:** Create a simple test button component that allows manual testing of Kokoro TTS synthesis. Add it to the Convert view.

**Depends on:** Task 2, Task 3

**Files to modify/create:**
- Create: `src/components/convert/KokoroTestButton.tsx` (Purpose: UI button to test Kokoro — loads model, synthesizes test sentence, plays audio)
- Modify: `src/components/convert/ConvertView.tsx` (Purpose: Import and render `KokoroTestButton`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the outline of `src/components/convert/ConvertView.tsx` to find where to add the button. Read the outline of `src/components/convert/ConvertButton.tsx` as a reference for the component pattern used in this codebase (Preact functional component with signals).
2. **Write Failing Test:** Write tests that verify:
   - Component renders a button with text "Test Kokoro".
   - On click, it calls `KokoroFallbackService.getInstance().preload()` (mocked) and then `synthesize()` with the fixed test sentence `"Hello, this is a test of the Kokoro text to speech engine."`.
   - Shows a loading state (disabled button or spinner text) while model is loading/synthesizing.
   - Shows an error state if synthesis fails (error text rendered).
   - On successful synthesis, creates an `Audio` element with the blob URL and calls `.play()`.
3. **Implement Minimal Code:** Create `KokoroTestButton` as a Preact functional component:
   - Use signals for `loading` and `error` state.
   - On click: set loading, call `preload()` then `synthesize(testSentence, 'female')`, create `URL.createObjectURL(blob)`, play via `new Audio(url).play()`.
   - Button disabled while loading, shows "Loading..." text. On error, shows error message.
   - Follow the same UX pattern as existing voice preview buttons in the codebase.
4. **Modify ConvertView:** Import `KokoroTestButton` and add it to the Convert view layout, placed near the existing `ConvertButton`.
5. **Verify:** Run the tests and ensure they pass.
6. **Commit:** Commit with message: `feat: add KokoroTestButton UI component for manual TTS testing`
