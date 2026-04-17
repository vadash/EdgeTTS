# Kokoro Fallback TTS

## Problem

When Edge TTS permanently fails a chunk (5 retries exhausted), the system replaces it with ~200ms of silence. For a 15-second sentence this creates an audible skip and breaks audiobook pacing. There is no voice-level fallback — the chunk is simply marked failed.

## Solution

Add an automatic fallback to Kokoro (local ONNX-based TTS) when Edge TTS permanently fails a chunk. Kokoro runs in a dedicated Web Worker, uses fixed male/female voice mapping, and synthesizes the failed text instead of inserting silence.

## Architecture

### New Files

```
src/services/KokoroFallbackService.ts    — service class (main thread)
src/services/workers/kokoro.worker.ts     — Web Worker (ONNX inference)
```

### Modified Files

```
src/services/TTSWorkerPool.ts             — call fallback after retries exhaust
webpack.config.js                         — CopyPlugin for WASM + coi-serviceworker
src/index.html                            — coi-serviceworker script tag (first in <head>)
```

## Components

### KokoroFallbackService

Single class on the main thread. Owns the Web Worker lifecycle.

```typescript
class KokoroFallbackService {
  private worker: Worker | null;
  private initPromise: Promise<void> | null;
  private _ready: boolean;

  // Start background model download. Non-blocking.
  preload(): void;

  // Ensure Kokoro is initialized (lazy). Called on first synthesis.
  private ensureReady(): Promise<void>;

  // Synthesize text with gender-appropriate voice. Returns audio Blob.
  synthesize(text: string, gender: 'male' | 'female'): Promise<Blob>;

  // Cleanup. Call on conversion end.
  dispose(): void;

  get ready(): boolean;
}
```

**Voice mapping:**

| Gender | Kokoro Voice | Grade |
|--------|-------------|-------|
| Female | `af_heart`  | A     |
| Male   | `am_fenrir` | C+    |

**Lifecycle:**

1. `preload()` — instantiates the Web Worker, sends `load` message. Worker fetches model from Hugging Face CDN (~83MB q8). Model bytes cached by browser HTTP cache.
2. `synthesize()` — if not yet initialized, awaits init (lazy). Sends `generate` message to worker. Returns audio Blob.
3. `dispose()` — terminates worker, clears state.

### kokoro.worker.ts

Dedicated Web Worker. Handles three message types:

| Message   | Direction     | Payload                           | Response                    |
|-----------|--------------|-----------------------------------|----------------------------|
| `load`    | Main → Worker | `{ modelId, dtype }`             | `{ type: 'ready' }`        |
| `generate`| Main → Worker | `{ text, voice }`                | `{ type: 'audio', blob }`  |
| `error`   | Worker → Main | `{ type: 'error', message }`     | —                          |

Uses `KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' })`.

### TTSWorkerPool Integration

In `executeTask()`, after the retry loop exhausts all 5 attempts:

```
Current flow:
  attempt > 5 → markFailed(task)

New flow:
  attempt > 5 → try KokoroFallbackService.synthesize(text, gender)
                 ├─ success → use Kokoro audio as chunk result
                 └─ failure → markFailed(task)  (same as before)
```

The fallback is synchronous from the pool's perspective — it awaits the result and either uses it or falls through to the existing failure path.

### Orchestrator Integration

`ConversionOrchestrator` creates `KokoroFallbackService` and passes it to `TTSWorkerPool`:

```typescript
// In runConversion():
const kokoroFallback = new KokoroFallbackService();
kokoroFallback.preload();  // background download starts
// ...
ttsWorkerPool.setKokoroFallback(kokoroFallback);
// ...
// On conversion end:
kokoroFallback.dispose();
```

Preload starts immediately when conversion begins. Model bytes download in background. If no chunks fail, Kokoro never initializes its inference session.

## Data Flow

```
ConversionOrchestrator
  │
  ├─ new KokoroFallbackService()
  ├─ kokoroFallback.preload()  ──→  kokoro.worker [downloads model]
  │
  ├─ TTSWorkerPool.run()
  │    │
  │    ├─ executeTask(chunk)
  │    │    ├─ Edge TTS attempt 1..5
  │    │    └─ all fail → kokoroFallback.synthesize(text, gender)
  │    │                   ├─ worker not ready → await init
  │    │                   ├─ worker generates audio → return Blob
  │    │                   └─ worker error → markFailed (silence fallback)
  │    │
  │    └─ completedAudio / failedTasks
  │
  ├─ AudioMerger.mergeAudioGroupAsync()
  │    └─ chunks from disk (Kokoro audio saved same as Edge TTS chunks)
  │
  └─ kokoroFallback.dispose()
```

## Cross-Origin Isolation (SharedArrayBuffer)

ONNX Runtime WASM threading requires `SharedArrayBuffer`, which needs COOP/COEP headers. On GitHub Pages (static hosting), headers can't be set server-side.

**Solution:** `coi-serviceworker` injects headers via a service worker on first visit.

**Changes:**

1. Install: `npm i coi-serviceworker`
2. Webpack: CopyPlugin copies `coi-serviceworker.js` to dist root
3. `index.html`: Add `<script src="/coi-serviceworker.js"></script>` as the first script in `<head>`
4. Copy ONNX Runtime `.wasm` files to dist root via CopyPlugin

**Trade-off:** First-visit page reload (one-time, ~1s). After that, the service worker handles headers transparently.

## Caching Behavior

| Asset | Size | Storage | Persists across sessions? |
|-------|------|---------|--------------------------|
| ONNX Runtime WASM binaries | ~few MB | Bundled in dist | Yes (served from site) |
| Kokoro ONNX model (q8) | ~83 MB | Browser HTTP cache | Yes (Hugging Face CDN sets cache headers) |
| ONNX inference session | — | In-memory (Web Worker) | No — re-initialized each page load, fast when model is cached |

**Flow for returning users:** Model bytes served from HTTP cache (no network). ONNX init is disk-to-memory only.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Kokoro worker fails to load model | Log warning, set `ready = false`. Fallback to silence for all chunks. |
| Kokoro synthesis fails for a chunk | Log error, mark chunk as failed (existing silence path). |
| SharedArrayBuffer unavailable | Single-threaded WASM fallback (`device: 'wasm'` without threads). Slower but functional. |
| Worker crashes mid-synthesis | Catch error in service, recreate worker on next call. |

## Config

```typescript
// src/config/index.ts or similar
const KOKORO_CONFIG = {
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'q8' as const,
  device: 'wasm' as const,
  voices: {
    male: 'am_fenrir',
    female: 'af_heart',
  },
};
```

No user-facing settings for now. Voice mapping is fixed. If needed later, a settings toggle to enable/disable Kokoro fallback can be added.

## Testing Strategy

| Layer | Approach |
|-------|----------|
| `KokoroFallbackService` | Mock the Worker interface. Test preload/init/synthesize/dispose lifecycle. |
| Worker messages | Unit test message handling with mocked `KokoroTTS`. |
| `TTSWorkerPool` integration | Test that after 5 Edge TTS failures, the fallback is called and its result used. |
| AudioMerger | No changes needed — Kokoro audio is saved to disk like any other chunk. |

## Scope Exclusions

- No user-configurable Kokoro voices (fixed mapping)
- No Kokoro-as-primary TTS (fallback only)
- No streaming synthesis (generate entire chunk at once)
- No UI indicators for Kokoro fallback status (future consideration)
