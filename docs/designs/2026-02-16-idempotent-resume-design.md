# Design: Idempotent Resume for TTS, Merge & LLM Steps

## 1. Problem Statement

Long conversions (1000+ chunks) fail or get cancelled mid-way. Restarting from scratch wastes significant time. We need to detect existing work in `_temp_work` and skip already-completed chunks/files.

## 2. Goals & Non-Goals

**Must do:**
- Resume LLM steps: cache `pipeline_state.json` after speaker assignment, skip LLM on resume
- Resume TTS step: skip chunks that already exist on disk
- Resume Merge step: skip opus files that already exist in output dir
- Job signature to detect stale cache (different text/settings)
- Modal UI asking user to confirm resume when cache is detected
- Progress bar starts at cached count (e.g. 423/1000)

**Won't do:**
- Explicit "Start Fresh" button (user deletes `_temp_work` manually)
- Pause/Resume runtime state machine
- Any new settings or toggles

## 3. Proposed Architecture

**Strategy: Disk is the Source of Truth + Idempotency**

The `_temp_work` directory already contains intermediate `chunk_XXXX.bin` files. Instead of deleting them at the start of each run, we check a job signature and reuse matching files.

### Flow

```
User clicks Convert → picks output folder → Orchestrator checks _temp_work
  ├─ _temp_work/job_signature.json exists & matches?
  │   ├─ YES → Show modal: "Resume previous session? (N chunks found)"
  │   │   ├─ User confirms → keep _temp_work, run pipeline
  │   │   └─ User cancels → (conversion doesn't start)
  │   └─ NO → delete _temp_work, write new signature, run pipeline
  ├─ _temp_work missing → create it, write signature, run pipeline
  │
  └─ Pipeline runs:
      ├─ LLM steps: check _temp_work/pipeline_state.json
      │   ├─ Found → load assignments/voiceMap/fileNames, skip all LLM steps
      │   └─ Missing → run LLM normally, then save pipeline_state.json
      ├─ TTS step: pre-scan _temp_work for existing chunk_*.bin
      │   ├─ Found → add to audioMap, increment progress
      │   └─ Missing → send to worker pool
      └─ Merge step: check output dir for existing .opus files
          ├─ Found (size > 0) → skip, log "already exists"
          └─ Missing → merge and encode
```

## 4. Data Models / Schema

### job_signature.json

```json
{
  "version": 1,
  "textHash": "sha256-first100-last100-length",
  "voice": "en-US-AriaNeural",
  "rate": "+0%",
  "pitch": "+0Hz",
  "outputFormat": "opus",
  "opusBitrate": "32k",
  "chunkCount": 1000,
  "createdAt": "2026-02-16T12:00:00Z"
}
```

The `textHash` is a lightweight fingerprint: `SHA-256(text.length + text.slice(0,200) + text.slice(-200))`. Fast, avoids hashing megabytes.

### pipeline_state.json

Saved to `_temp_work` after `SpeakerAssignmentStep` completes. Contains all LLM-derived data needed to skip the LLM steps on resume.

```json
{
  "assignments": [
    { "text": "Hello world.", "speaker": "Narrator", "voiceId": "en-US-AriaNeural" }
  ],
  "characterVoiceMap": {
    "Narrator": "en-US-AriaNeural",
    "Alice": "en-US-JennyNeural"
  },
  "fileNames": ["Chapter 1", "Chapter 2"]
}
```

On resume, the orchestrator loads this file and injects the data into `PipelineContext`, then skips `CharacterExtractionStep`, `VoiceAssignmentStep`, `SpeakerAssignmentStep`, and `VoiceRemappingStep` entirely.

### ResumeInfo (passed to UI)

```ts
interface ResumeInfo {
  /** Number of cached TTS chunks found */
  cachedChunks: number;
  /** Total chunks expected */
  totalChunks: number;
  /** Number of cached opus files found in output dir */
  cachedOutputFiles: number;
  /** Whether LLM state (pipeline_state.json) is cached */
  hasLLMState: boolean;
}
```

## 5. Interface / API Design

### ConversionOrchestrator changes

```ts
// New method
private async checkResumable(
  targetDirHandle: FileSystemDirectoryHandle,
  text: string,
  settings: ConversionSettings
): Promise<ResumeInfo | null>
// Returns null if no valid cache, ResumeInfo if resumable

// On resume with pipeline_state.json:
// 1. Load pipeline_state.json
// 2. Pre-fill PipelineContext with assignments, characterVoiceMap, fileNames
// 3. Skip LLM steps (CharacterExtraction, VoiceAssignment, SpeakerAssignment, VoiceRemapping)
// 4. Start pipeline from TextSanitization or TTSConversion directly
```

### SpeakerAssignmentStep changes

```ts
// At end of execute(), after generating assignments:
// Write pipeline_state.json to _temp_work with:
//   - assignments, characterVoiceMap, fileNames
// This is the save point for LLM results
```

### Resume modal callback

```ts
// Added to orchestrator options or conversion store
onResumeDetected: (info: ResumeInfo) => Promise<boolean>
// Returns true = resume, false = cancel
```

### TTSConversionStep changes

```ts
// In execute():
// Before creating worker tasks, scan tempDirHandle for existing files
// For each assignment, check if chunk_{partIndex}.bin exists
// If exists → add to audioMap, report progress
// If not → add to tasks array
// Only start worker pool if tasks.length > 0
```

### AudioMergeStep changes

```ts
// In execute():
// Before merging each group, check if output file exists in targetDirHandle
// If exists and size > 0 → skip, log, continue
// If not → merge normally
```

## 6. UI Components

### ResumeModal (new component)

Simple modal shown after folder pick when cache is detected. Reuse existing modal patterns (like VoiceReviewModal).

```
┌──────────────────────────────────────┐
│  ↻ Previous Session Found            │
│                                      │
│  ✓ LLM voice assignments cached     │
│  423 of 1000 audio chunks cached.    │
│  2 of 5 output files already exist.  │
│                                      │
│  [Continue]          [Cancel]        │
└──────────────────────────────────────┘
```

Lines shown conditionally (e.g. LLM line only if `hasLLMState` is true).

- **Continue** → orchestrator keeps `_temp_work`, runs pipeline
- **Cancel** → returns to idle state (no deletion)

No "Start Fresh" button — if user wants fresh, they delete the temp folder.

### Progress bar behavior on resume

Progress bar total = all chunks. Current = cached chunks count at start. As new chunks complete, progress increments normally. User sees it "jump" to 423/1000 immediately, then proceed 424, 425...

StatusPanel logs:
```
[INFO] Resuming: found 423/1000 cached TTS chunks
[INFO] Resuming: found 2/5 output files
[INFO] TTS: processing remaining 577 chunks...
```

## 7. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| Partial chunk file (crash during write) | Check file size > 0. Optionally validate first few bytes of audio header. |
| Signature matches but chunks are corrupt | Accept the risk. User can delete `_temp_work` manually. |
| Output file exists but is partial (crash during merge) | Check file size > some minimum threshold (e.g. 1KB). |
| User changes text slightly (e.g. fixes typo) | Signature changes → full re-run. This is correct behavior. |
| `_temp_work` grows unbounded across sessions | Orchestrator already cleans it on signature mismatch. Only one session's temp data exists at a time. |
| Browser revokes folder permission between cancel and resume | User re-grants permission via folder picker. Normal browser flow. |

## 8. Files to Modify

1. **`src/services/ConversionOrchestrator.ts`** — signature check, resume detection, modal callback, LLM state hydration
2. **`src/services/pipeline/steps/SpeakerAssignmentStep.ts`** — save `pipeline_state.json` after LLM completes
3. **`src/services/pipeline/steps/TTSConversionStep.ts`** — pre-scan for cached chunks
4. **`src/services/pipeline/steps/AudioMergeStep.ts`** — check for existing output files
5. **`src/components/convert/ConvertButton.tsx`** or **`ConvertView.tsx`** — wire up resume modal
6. **New: `src/components/convert/ResumeModal.tsx`** — simple confirmation modal
7. **`src/stores/conversion.ts`** (or equivalent) — resume state signal if needed
