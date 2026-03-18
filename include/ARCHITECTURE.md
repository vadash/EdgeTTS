# Architecture: Edge TTS Web

## 1. System Overview
**WHAT**: Edge TTS Web is a local-first, browser-based Text-to-Speech application. It converts books (EPUB, FB2, TXT) into high-quality audiobooks (Opus) using Microsoft Edge's TTS WebSocket API and LLMs (OpenAI-compatible) for dynamic character voice assignment.
**WHY**: To provide a free, privacy-respecting, UI-driven audiobook generator that can handle massive texts without running out of memory, while utilizing LLMs to automatically voice different characters in dialogue.
**HOW**: Built on Preact, `@preact/signals`, and Webpack. It relies heavily on the **File System Access API** to stream data to disk, preventing browser Out-Of-Memory (OOM) crashes, and **FFmpeg.wasm** for local audio processing.

## 2. Tech Stack & Core Libraries
*   **UI Framework:** Preact + Tailwind CSS
*   **State Management:** `@preact/signals` (Global singletons in `/src/stores`)
*   **Audio Processing:** `@ffmpeg/ffmpeg` (WASM-based local processing)
*   **LLM Integration:** `openai` SDK + `zod` (Strict Structured Outputs using Zod 4 `toJSONSchema`)
*   **Resilience:** `p-retry` (Wrapped in custom `withRetry` utilities)
*   **File Handling:** `jszip`, DOMParser (for FB2/EPUB extraction)

## 3. Directory Structure (The Map)
When working on specific features, refer to these locations:

*   `src/components/` - Preact UI components grouped by feature (`convert`, `settings`, `layout`, `status`).
*   `src/stores/` - Global state management. Contains `.ts` files exporting Signals.
*   `src/services/` - Core business logic, singletons, and orchestration.
    *   `src/services/llm/` - Everything related to API calls, parsing, prompts, and consensus voting.
    *   `src/services/audio/` - FFmpeg filter chains and audio formatting.
*   `src/config/` - Hardcoded constants, defaults, and LLM prompt templates (`src/config/prompts/`).
*   `src/utils/` - Pure helper functions (language detection, text sanitization, retries).
*   `src/state/types.ts` - Global TypeScript interfaces.

## 4. The Core Pipeline (`ConversionOrchestrator.ts`)
The conversion process is a linear pipeline managed by `ConversionOrchestrator.ts`. The data flows as follows:

1.  **Parsing:** `FileConverter.ts` extracts raw text from EPUB/FB2/ZIP.
2.  **Splitting:** `TextBlockSplitter.ts` splits text into paragraphs, then groups them into token-limited blocks for the LLM.
3.  **LLM Stage 1 (Extract):** Identifies all speaking characters and their genders.
4.  **LLM Stage 2 (Merge):** Deduplicates characters (e.g., "The King" and "Arthur" if they are the same person).
5.  **LLM Stage 3 (Assign):** Reads numbered sentences and assigns a speaker code to dialogue. *Note: We use a multi-temperature 3-way/5-way voting consensus to ensure high accuracy.*
6.  **Voice Allocation:** `VoiceAllocator.ts` maps identified characters to actual Edge TTS voices based on gender and line frequency.
7.  **TTS Generation:** `TTSWorkerPool.ts` orchestrates WebSockets to fetch audio. Uses a `LadderController` to dynamically scale concurrent workers up/down based on rate limits.
8.  **Audio Merging:** `AudioMerger.ts` groups MP3 chunks by duration and sends them to `FFmpegService.ts` for silence removal, normalization, and Opus encoding.

## 5. State Management Rules (`@preact/signals`)
*   State is managed in `/src/stores/`.
*   Stores export a primary signal (e.g., `export const settings = signal<AppSettings>(...)`).
*   Stores also export explicit computed values and action functions (e.g., `setRate()`, `patchSettings()`).
*   **Never mutate signals directly from UI components.** Always use the exported action functions from the store.

## 6. Key Design Decisions & Gotchas (CRITICAL)

### A. Memory Management (OOM Prevention)
Browsers crash if you hold hundreds of megabytes of audio in RAM.
*   **Rule:** NEVER keep full audio arrays in memory.
*   **Implementation:** `TTSWorkerPool` writes individual sentence MP3s directly to a `_temp_work` folder on the user's hard drive via the File System Access API. `AudioMerger` reads these from disk one by one.

### B. Network & Async Resilience
Long-running audiobook generations (hours) are vulnerable to network drops, API rate limits, and the computer going to sleep.
*   **Retries:** ALL network calls (LLM & TTS) must be wrapped in `withRetry` (found in `src/utils/retry/network.ts`).
*   **KeepAwake:** `KeepAwake.ts` uses Web Locks, Screen Wake Lock, and a silent AudioContext oscillator to trick the browser into not throttling background tabs.
*   **Resumability:** Pipeline state is saved to `pipeline_state.json`. `ResumeCheck.ts` allows users to resume a halted generation without re-running expensive LLM calls.

### C. File System Permissions
Browsers will drop File System permissions if the tab is inactive too long.
*   **Rule:** ALL disk writes/reads must be wrapped in `withPermissionRetry` (`src/utils/retry/filesystem.ts`), which catches `NotAllowedError` and re-prompts the user automatically.

### D. LLM "Structured Outputs"
We use OpenAI's Strict Structured Outputs.
*   Schemas are defined in `src/services/llm/schemas.ts` using `zod`.
*   Because LLMs hallucinate syntax (e.g., mid-string concatenation like `"text" + "more"`), responses pass through `safeParseJSON` (`src/utils/text.ts`), which strips markdown fences, reasoning tags (`<think>`), and applies `jsonrepair` before Zod validation.