# Kokoro Fallback TTS v3

## Problem

When Edge TTS permanently fails a chunk (5 retries exhausted), the system replaces it with ~200ms of silence. For a 15-second sentence this creates an audible skip and breaks audiobook pacing. There is no voice-level fallback — the chunk is simply marked failed.

## Solution

Add an automatic fallback to Kokoro (local ONNX-based TTS) when Edge TTS permanently fails a chunk. Kokoro runs in a dedicated Web Worker, uses fixed voice mapping per gender, and synthesizes the failed text instead of inserting silence.

## Architecture

### New Files

```
src/services/KokoroFallbackService.ts    — singleton service (main thread)
src/services/workers/kokoro.worker.ts     — Web Worker (ONNX inference)
src/components/KokoroTestButton.tsx       — UI test button
```

### Modified Files

```
src/services/TTSWorkerPool.ts             — trigger preload on retry #2, call fallback after retries exhaust
webpack.config.js                         — CopyPlugin for ONNX Runtime WASM files
src/components/ConvertView.tsx            — add KokoroTestButton
```

## Components

### KokoroFallbackService

**Global singleton.** Not created/destroyed per conversion. Persists across conversions with an inactivity timeout.

```typescript
class KokoroFallbackService {
  private static instance: KokoroFallbackService | null;
  private worker: Worker | null;
  private initPromise: Promise<void> | null;
  private _ready: boolean;
  private lastUsedAt: number;
  private inactivityTimer: ReturnType<typeof setTimeout> | null;

  // 5-minute inactivity timeout — disposes worker to free RAM
  private static readonly INACTIVITY_MS = 5 * 60 * 1000;
  // 20-second synthesis timeout — prevents frozen pipeline if worker hangs/killed
  private static readonly SYNTHESIS_TIMEOUT_MS = 20_000;
  // Kokoro safe max chars per generate() call
  private static readonly MAX_CHUNK_CHARS = 300;

  static getInstance(): KokoroFallbackService;

  // Dedicated FFmpeg instance for Kokoro transcodes only.
  // Isolated from the shared FFmpegService singleton used by AudioMerger
  // to avoid concurrency conflicts (@ffmpeg/ffmpeg is single-instance).
  private ffmpeg: FFmpegService;

  // Start background model download. Non-blocking.
  // Idempotent: returns existing initPromise if preload already in progress.
  preload(): Promise<void>;

  // Ensure Kokoro is initialized (lazy). Called on first synthesis.
  // Returns existing initPromise if init already in progress.
  private ensureReady(): Promise<void>;

  // Synthesize text with gender-appropriate voice.
  // Returns MP3 Blob (24kHz 96kbps mono) matching Edge TTS output format.
  // Wraps worker call in Promise.race with 20s timeout.
  // If text > MAX_CHUNK_CHARS, splits on sentence boundaries and generates
  // each sub-chunk sequentially, concatenating PCM before WAV encoding.
  synthesize(text: string, gender: 'male' | 'female' | 'unknown'): Promise<Blob>;

  // Reset inactivity timer. Called after each successful use.
  private resetInactivityTimer(): void;

  // Terminate worker, clear state. Called after 5 min inactivity.
  private dispose(): void;

  get ready(): boolean;
}
```

**Voice mapping:**

| Gender | Kokoro Voice | Grade | Notes |
|--------|-------------|-------|-------|
| Female | `af_heart`  | A     | Best overall voice |
| Male   | `am_fenrir` | C+    | Best male American |
| Unknown | `af_heart` | A     | Narrator/default — pleasant neutral female |

Unknown maps to `af_heart` (grade A, best overall). This aligns with narrator use — a pleasant, clear voice for undescribed entities.

**Lifecycle:**

1. `preload()` — instantiates the Web Worker, sends `load` message. Worker fetches model from Hugging Face CDN (~83MB q8). Model bytes cached by browser HTTP cache. **Idempotent** — if called while already loading, returns the existing `initPromise` so concurrent callers share one download. **Not called at conversion start** — triggered lazily on retry attempt #2.
2. `synthesize()` — if not yet initialized, awaits init (lazy). Sends `generate` message to worker. Wraps in `Promise.race` with 20s timeout. Transcodes PCM output to MP3 via a **dedicated FFmpegService instance** before returning. Resets inactivity timer.
3. `dispose()` — terminates worker, terminates dedicated FFmpeg instance, clears state. Called automatically after 5 minutes of inactivity, or manually if needed.

### kokoro.worker.ts

Dedicated Web Worker. Single-threaded WASM (no SharedArrayBuffer/COOP/COEP required). Handles three message types:

| Message   | Direction     | Payload                           | Response                         |
|-----------|--------------|-----------------------------------|----------------------------------|
| `load`    | Main → Worker | `{ modelId, dtype }`             | `{ type: 'ready' }`             |
| `generate`| Main → Worker | `{ text, voice }`                | `{ type: 'audio', pcmData, sampleRate }` |
| `error`   | Worker → Main | `{ type: 'error', message }`     | —                                |

Worker returns raw PCM `Float32Array` (transferred, zero-copy) instead of WAV blob. This avoids the RIFF header problem when concatenating multiple sub-chunks — you can safely concatenate `Float32Array` buffers mathematically before encoding a single WAV downstream.

Uses `KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' })`.

No multi-threading. Single-threaded WASM is sufficient for fallback sentences (typically 50-200 chars, ~5-10s of audio).

### TTSWorkerPool Integration

Two integration points:

**1. Trigger preload on retry attempt #2:**

In `handleTaskFailure()`, when `attempt === 2`:

```typescript
if (attempt === 2) {
  kokoroFallback.preload();  // idempotent — concurrent callers share one download
}
```

Rationale: If a chunk hits retry #2, there's a real chance it might fail completely. Starting the model download then gives it ~3 retry cycles (~30-90s) to complete before Kokoro is needed at attempt #5. If no chunks fail, zero bandwidth is wasted.

**Thundering herd safety:** With `ttsThreads` up to 20, many tasks can hit retry #2 simultaneously. `preload()` is idempotent — it stores the init promise and returns it for all callers. Only one worker is created, only one 83MB download starts. The guard is inside `preload()` itself, not at the call site.

**2. Call fallback after all retries exhaust:**

In `handleTaskFailure()`, after `attempt > 5`:

```
Current flow:
  attempt > 5 → markFailed(task)

New flow:
  attempt > 5 → try kokoroFallback.synthesize(text, gender)
                 ├─ success → save MP3 blob to ChunkStore as chunk result
                 └─ failure → markFailed(task)  (same as before)
```

The fallback is synchronous from the pool's perspective — it awaits the result and either uses it or falls through to the existing failure path.

### Audio Format: PCM → WAV → MP3 Transcoding

Kokoro's `tts.generate()` returns raw PCM float data. Edge TTS outputs `audio-24khz-96kbitrate-mono-mp3`. The `AudioMerger` pipeline processes all chunks uniformly — format mismatch would cause corrupted output.

**Worker returns raw PCM, not WAV blobs.** This avoids the WAV RIFF header concatenation problem (a 44-byte header in the middle of a concatenated audio stream corrupts the file).

**Transcode pipeline:**

```
Kokoro worker → Float32Array PCM → encodeWavHeader(pcmData) → WAV blob → dedicated FFmpeg → MP3 blob → ChunkStore
```

**Dedicated FFmpeg instance.** The shared `getFFmpeg()` singleton (`src/services/index.ts`) is used by `AudioMerger` for the final merge. `@ffmpeg/ffmpeg` v0.12 does not support concurrent operations on a single instance — if Kokoro transcoding and AudioMerger's final merge overlap, FFmpeg will crash. KokoroFallbackService creates its own `new FFmpegService()` instance, completely isolated from the shared one. This instance is terminated in `dispose()` along with the worker.

The transcoded MP3 matches Edge TTS output format exactly (24kHz, 96kbps, mono), so `AudioMerger` processes it identically to any other chunk.

### Long Text Handling

Kokoro's model has a hard context length limit. Safe ceiling per `tts.generate()` call is ~300 chars. Typical TTS chunks (individual sentences from `SpeakerAssignment`) are 50-200 chars — well within limits.

For the rare long sentence (>300 chars), the worker returns raw `Float32Array` PCM per sub-chunk. Concatenation is a simple typed array merge — no RIFF headers to worry about:

```typescript
if (text.length > MAX_CHUNK_CHARS) {
  const subChunks = splitOnSentenceBoundaries(text, MAX_CHUNK_CHARS);
  const pcmChunks: Float32Array[] = [];
  for (const chunk of subChunks) {
    const pcm = await this.generateSingle(chunk, voice);  // returns Float32Array
    pcmChunks.push(pcm);
  }
  // Concatenate raw PCM — safe because it's just float samples
  pcmData = new Float32Array(pcmChunks.reduce((sum, arr) => sum + arr.length, 0));
  let offset = 0;
  for (const arr of pcmChunks) {
    pcmData.set(arr, offset);
    offset += arr.length;
  }
} else {
  pcmData = await this.generateSingle(text, voice);
}

// Encode once: concatenated PCM → single WAV → MP3 via dedicated FFmpeg
const wavBlob = encodeWav(pcmData, sampleRate);
```

Split on sentence-ending punctuation (`.!?`) with a hard cutoff fallback. Each sub-chunk generates independently, PCM arrays concatenate, then a single WAV is encoded and transcoded to MP3.

### Orchestrator Integration

`KokoroFallbackService` is a global singleton — not created by the orchestrator. `TTSWorkerPool` accesses it via `KokoroFallbackService.getInstance()`.

```typescript
// TTSWorkerPool constructor or setter:
this.kokoroFallback = KokoroFallbackService.getInstance();
```

No orchestrator changes needed for lifecycle — the singleton manages its own lifecycle via inactivity timeout.

### UI Test Button

A simple button in the Convert view for testing Kokoro:

- Button labeled "Test Kokoro"
- On click: loads Kokoro (if not already), synthesizes a fixed test sentence ("Hello, this is a test of the Kokoro text to speech engine."), plays the result
- Shows loading state while model downloads/inits
- Shows error state if loading fails
- Same UX pattern as existing voice preview buttons

## Data Flow

```
TTSWorkerPool.handleTaskFailure()
  │
  ├─ attempt === 2 → kokoroFallback.preload() (idempotent, shares initPromise)
  │
  └─ attempt > 5 → kokoroFallback.synthesize(text, gender)
                     │
                     ├─ ensureReady() — await init if not done
                     │
                     ├─ text > 300 chars? → split into sub-chunks
                     │
                     ├─ Send 'generate' to kokoro.worker
                     │    └─ KokoroTTS.generate(text, voice) → Float32Array PCM
                     │
                     ├─ [if split] concatenate Float32Arrays
                     │
                     ├─ encodeWav(pcmData) → WAV blob
                     │
                     ├─ dedicated FFmpeg.transcodeToMp3(wavBlob)
                     │    └─ 24kHz 96kbps mono MP3 blob
                     │
                     ├─ resetInactivityTimer()
                     │
                     └─ return MP3 blob → save to ChunkStore
```

## Caching Behavior

| Asset | Size | Storage | Persists across sessions? |
|-------|------|---------|--------------------------|
| ONNX Runtime WASM binaries | ~few MB | Bundled in dist (CopyPlugin) | Yes (served from site) |
| Kokoro ONNX model (q8) | ~83 MB | Browser HTTP cache | Yes (Hugging Face CDN sets cache headers) |
| ONNX inference session | — | In-memory (Web Worker) | No — re-initialized on worker creation, fast when model is cached |

**Flow for returning users:** Model bytes served from HTTP cache (no network). ONNX init is disk-to-memory only. Worker persists across conversions until 5-min inactivity timeout.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Kokoro worker fails to load model | Log warning, set `ready = false`. Fallback to silence for all chunks. |
| Kokoro synthesis fails for a chunk | Log error, mark chunk as failed (existing silence path). |
| Worker hangs or killed by OS (mobile jetsam) | `Promise.race` with 20s timeout resolves to failure → markFailed (silence fallback). |
| Worker crashes mid-synthesis | Catch error in service, recreate worker on next call. |
| Long text exceeds model limit | Split on sentence boundaries, generate sequentially, concatenate Float32Array PCM. |
| Kokoro FFmpeg instance fails | Log error, mark chunk as failed (existing silence path). Shared FFmpegService unaffected — instances are isolated. |

## Config

```typescript
const KOKORO_CONFIG = {
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8' as const,
  device: 'wasm' as const,       // single-threaded, no SharedArrayBuffer needed
  voices: {
    male: 'am_fenrir',
    female: 'af_heart',
    unknown: 'af_heart',
  },
  maxChunkChars: 300,             // safe ceiling for tts.generate()
  inactivityTimeoutMs: 5 * 60 * 1000,
  synthesisTimeoutMs: 20_000,
  preloadOnRetryAttempt: 2,
} as const;
```

No user-facing settings for now. Voice mapping is fixed. If needed later, a settings toggle to enable/disable Kokoro fallback can be added.

## Webpack Changes

```javascript
// webpack.config.js — CopyPlugin patterns
{
  from: 'node_modules/onnxruntime-web/dist/*.wasm',
  to: '[name][ext]',
}
```

No `coi-serviceworker`. No changes to `index.html`. Single-threaded WASM runs without cross-origin isolation.

## Testing Strategy

| Layer | Approach |
|-------|----------|
| `KokoroFallbackService` | Mock the Worker interface. Test singleton lifecycle, preload/init/synthesize/timeout/dispose. Test long-text splitting (Float32Array concatenation). Test 20s timeout. Test inactivity timer. Test preload idempotency (concurrent calls share one promise). |
| Worker messages | Unit test message handling with mocked `KokoroTTS`. Verify `generate` returns raw PCM `Float32Array` (not WAV blob). |
| `TTSWorkerPool` integration | Test that preload triggers on retry #2. Test that after 5 failures, fallback is called and MP3 result saved. |
| PCM→WAV→MP3 transcoding | Test that dedicated FFmpegService receives WAV blob (from `encodeWav`) and produces MP3 matching Edge TTS format. Verify shared FFmpegService instance is never touched. |
| `KokoroTestButton` | Component renders, triggers preload + synthesize on click, shows loading/error states. |
| AudioMerger | No changes needed — Kokoro MP3 is identical format to Edge TTS chunks. |

## Scope Exclusions

- No user-configurable Kokoro voices (fixed mapping)
- No Kokoro-as-primary TTS (fallback only)
- No `coi-serviceworker` / cross-origin isolation (single-threaded WASM)
- No streaming synthesis (generate entire chunk at once)
- No UI indicators for Kokoro fallback status during conversion (future consideration)
