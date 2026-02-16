# Design: Remove v1 Voice Mapping Format

## 1. Problem Statement

Two parallel voice profile systems exist:

| | **v1 (Active)** | **v2 (Dead Code)** |
|---|---|---|
| File | `VoiceMappingService.ts` | `VoiceProfile.ts` |
| Export | `exportToJSON()` / `exportToJSONSorted()` | `exportToProfile()` |
| Import | `importFromJSON()` | `importProfile()` |
| Tracks frequency | ❌ Discards counts after sorting | ✅ Writes `lines`, `percentage` |
| Cumulative merge | ❌ | ✅ |
| Name matching | 5-level cascade + prefix stripping | Levenshtein multi-pairing |
| Called from UI | ✅ | ❌ Zero callers |

The v2 system is fully implemented but never wired in. The v1 system produces files with no frequency data, making series voice profiles useless.

**Action:** Delete all v1 code. Wire v2 into the application. No migration, no fallback, no backward compatibility.

## 2. Goals & Non-Goals

### Must Do:
- [x] Delete `VoiceMappingService.ts` entirely
- [x] Move format-agnostic utilities into `VoiceProfile.ts`
- [x] Wire `exportToProfile()` into SaveStep
- [x] Wire `importProfile()` into VoiceReviewModal
- [x] Use Levenshtein matching (`NameMatcher.ts`) as the only matcher
- [x] Move profile save to right after voice review (before TTS)
- [x] Show clear error when user imports v1 JSON
- [x] Delete `VoiceMappingService.test.ts`
- [x] Resume system unchanged (pipeline_state.json stays as-is)

### Won't Do:
- [ ] v1 → v2 migration tool
- [ ] Fallback parsing for v1 files
- [ ] Backward compatibility of any kind
- [ ] Changes to pipeline_state.json format

## 3. Proposed Architecture

### Pipeline Order Change

**Before:**
```
CharExtract → VoiceAssign → SpeakerAssign → VoiceRemap → [PAUSE: voice review]
→ TextSanitize → Dictionary → TTS → AudioMerge → Save(profile) → Cleanup
```

**After:**
```
CharExtract → VoiceAssign → SpeakerAssign → VoiceRemap → [PAUSE: voice review]
→ Save(profile) → TextSanitize → Dictionary → TTS → AudioMerge → Cleanup
```

**Why:** Profile is saved immediately after user confirms voices. On resume, profile already exists on disk. `pipeline_state.json` never needs profile data.

### Resume Interaction

```
Resume flow:
1. pipeline_state.json found → skip LLM steps
2. Profile already saved to {bookName}/{bookName}.json (from previous run's voice review)
3. TTS/Merge steps resume normally
4. No profile re-export needed on resume
```

If user re-runs without resume (fresh start), profile gets overwritten with new data — correct behavior.

### File Consolidation

**Delete:** `VoiceMappingService.ts`, `VoiceMappingService.test.ts`

**Move to `VoiceProfile.ts`:**
- `randomizeBelowVoices()` — format-agnostic, used by VoiceReviewModal
- `sortVoicesByPriority()` — used by randomizeBelowVoices
- `downloadJSON()` — generic file download helper
- `readJSONFile()` — generic file read helper

**Delete entirely (not moved):**
- `VoiceMappingFile` interface — replaced by `VoiceProfileFile`
- `VoiceMappingEntry` interface — replaced by `CharacterEntry`
- `exportToJSON()` — replaced by `exportToProfile()`
- `exportToJSONSorted()` — replaced by `exportToProfile()`
- `importFromJSON()` — replaced by `importProfile()`
- `normalizeForMatch()` — replaced by Levenshtein matching
- `findMatchingEntry()` — replaced by `matchCharacter()` from NameMatcher.ts
- `applyImportedMappings()` — replaced by `importProfile()`
- `containsAtWordBoundary()` — private helper, deleted with its parent
- `STRIP_PREFIXES` — deleted with normalizeForMatch
- `MIN_SPEAKING_PERCENTAGE` — replaced by `IMPORTANCE_THRESHOLD` from types.ts

### Name Matching: Levenshtein Only

All matching goes through `matchCharacter()` in `NameMatcher.ts`:
- Uses `findMaxPairings()` (greedy bipartite matching)
- Requires `MIN_NAME_PAIRINGS` (2) independent name pairings
- Each pairing must have Levenshtein distance ≤ `MAX_NAME_EDITS` (2)

The v1 cascade matcher (`findMatchingEntry`) is deleted. No dual matcher.

## 4. Data Models / Schema

### Output Format (only format, replaces v1)

```json
{
  "version": 2,
  "narrator": "en-US-GuyNeural",
  "totalLines": 5000,
  "characters": {
    "harry_potter": {
      "canonicalName": "Harry Potter",
      "voice": "en-GB-RyanNeural",
      "gender": "male",
      "aliases": ["Harry", "Potter", "The Boy Who Lived"],
      "lines": 750,
      "percentage": 15.0,
      "lastSeenIn": "BOOK3",
      "bookAppearances": 3
    }
  }
}
```

### v1 Import Error

When `importProfile()` receives JSON without `version: 2`:

```typescript
if (profile.version !== 2) {
  throw new Error('Unsupported voice profile format. Re-export from a current session.');
}
```

UI catches this and displays the error message in the import section of VoiceReviewModal.

## 5. Interface / API Design

### VoiceProfile.ts (consolidated)

```typescript
// === PROFILE FUNCTIONS (existing) ===

export function exportToProfile(
  existingProfile: VoiceProfileFile | null,
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string,
  sessionName: string
): string;

export function importProfile(
  profileJson: string,
  currentCharacters: LLMCharacter[]
): {
  voiceMap: Map<string, string>;
  matchedCharacters: Set<string>;
  unmatchedCharacters: string[];
};

export function isCharacterVisible(entry: CharacterEntry): boolean;

export function assignVoicesTiered(
  characters: CharacterEntry[],
  availableVoices: VoiceOption[],
  narratorVoice: string
): Map<string, VoiceAssignmentResult>;

// === MOVED FROM VoiceMappingService.ts ===

export function sortVoicesByPriority(
  voices: VoiceOption[],
  bookLanguage: DetectedLanguage,
  narratorVoice: string
): VoiceOption[];

export interface RandomizeBelowParams {
  sortedCharacters: LLMCharacter[];
  currentVoiceMap: Map<string, string>;
  clickedIndex: number;
  enabledVoices: VoiceOption[];
  narratorVoice: string;
  bookLanguage: DetectedLanguage;
}

export function randomizeBelowVoices(params: RandomizeBelowParams): Map<string, string>;

export function downloadJSON(json: string, filename: string): void;

export function readJSONFile(file: File): Promise<string>;
```

### SaveStep.ts (updated)

```typescript
// Before:
import { exportToJSONSorted } from '@/services/VoiceMappingService';
const json = exportToJSONSorted(characters, voiceMap, assignments, narratorVoice);

// After:
import { exportToProfile } from '@/services/llm/VoiceProfile';
const json = exportToProfile(
  null,            // existingProfile — null for first session, loaded from prev for series
  characters,
  voiceMap,
  assignments,
  narratorVoice,
  bookName
);
```

### VoiceReviewModal.tsx (updated import path)

```typescript
// Before:
import { importFromJSON, applyImportedMappings, readJSONFile, ... } from '@/services/VoiceMappingService';
const { entries, narrator } = importFromJSON(json);
const newMap = applyImportedMappings(entries, characters, voiceMap);

// After:
import { importProfile, readJSONFile, ... } from '@/services/llm/VoiceProfile';
const { voiceMap: importedMap, matchedCharacters, unmatchedCharacters } = importProfile(json, characters);
// Merge importedMap into current voiceMap
```

### PipelineBuilder.ts (reorder)

```typescript
// After voice review pause, BEFORE text sanitization:
const config = builder
  .addStep(StepNames.SAVE, {           // ← moved here
    narratorVoice: options.narratorVoice,
  })
  .addStep(StepNames.TEXT_SANITIZATION, {})
  .addStep(StepNames.DICTIONARY_PROCESSING, { ... })
  .addStep(StepNames.TTS_CONVERSION, { ... })
  .addStep(StepNames.AUDIO_MERGE, { ... })
  // No SAVE here anymore
  .addStep(StepNames.CLEANUP, { ... })
  .build();
```

### SaveStep.ts Simplification

SaveStep currently also reports `savedFileCount` for audio files. After reorder, audio files haven't been saved yet when SaveStep runs. SaveStep becomes profile-only:

```typescript
export class SaveStep extends BasePipelineStep {
  readonly name = 'save';
  // No longer drops assignments/characters/voiceMap — TTS still needs them
  readonly dropsContextKeys: (keyof PipelineContext)[] = [];

  async execute(context: PipelineContext, signal: AbortSignal): Promise<PipelineContext> {
    this.checkCancelled(signal);

    const { directoryHandle, characters, voiceMap, assignments, fileNames } = context;

    if (directoryHandle && characters && voiceMap && assignments) {
      const bookName = this.extractBookName(fileNames);
      const json = exportToProfile(null, characters, voiceMap, assignments, this.options.narratorVoice, bookName);

      const bookFolder = await directoryHandle.getDirectoryHandle(bookName, { create: true });
      const fileHandle = await bookFolder.getFileHandle(`${bookName}.json`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();

      this.reportProgress(1, 1, `Saved voice profile: ${bookName}/${bookName}.json`);
    }

    return context;
  }
}
```

**Key change:** `dropsContextKeys` is now empty. The old SaveStep dropped `assignments`, `characters`, `voiceMap` because it was last before cleanup. Now it runs before TTS, so those must stay in context.

### Series Profile Loading (future, in VoiceReviewModal)

When importing a previous session's profile, the import button in VoiceReviewModal:
1. Reads v2 JSON file
2. Calls `importProfile(json, currentCharacters)`
3. Gets back `{ voiceMap, matchedCharacters, unmatchedCharacters }`
4. Applies `voiceMap` to current session
5. Optionally shows matched/unmatched summary

For cumulative export (BOOK2 building on BOOK1):
- SaveStep needs the previously loaded profile passed through context
- `exportToProfile(existingProfile, ...)` merges counts

This requires adding `existingProfile` to `PipelineContext`:

```typescript
// In PipelineContext:
existingProfile?: VoiceProfileFile;
```

VoiceReviewModal sets it when user imports a profile. SaveStep passes it to `exportToProfile()`.

## 6. Risks & Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User imports old v1 JSON | Error: "Unsupported voice profile format. Re-export from a current session." |
| Resume after profile saved | Profile already on disk, no action needed. TTS/Merge resume normally. |
| Resume before profile saved (crash during LLM) | No profile on disk. Normal behavior — LLM re-runs, then profile saves after voice review. |
| SaveStep fails (disk error) | Non-fatal, same as current. Conversion continues. Profile can be re-exported. |
| `existingProfile` is null (first session) | `exportToProfile(null, ...)` creates fresh profile. Already handled. |
| Audio file count no longer in SaveStep | AudioMergeStep already logs per-file saves. Final count moves to Cleanup or ConversionOrchestrator completion log. |

## 7. Files to Modify

| Action | File | What |
|--------|------|------|
| **DELETE** | `src/services/VoiceMappingService.ts` | Entire file |
| **DELETE** | `src/services/VoiceMappingService.test.ts` | Entire file |
| **MODIFY** | `src/services/llm/VoiceProfile.ts` | Add moved utilities, update `importProfile()` to reject non-v2 |
| **MODIFY** | `src/services/llm/VoiceProfile.test.ts` | Add tests for moved utilities |
| **MODIFY** | `src/services/pipeline/steps/SaveStep.ts` | Use `exportToProfile()`, remove `dropsContextKeys`, remove audio count reporting |
| **MODIFY** | `src/services/pipeline/PipelineBuilder.ts` | Move SAVE step before TEXT_SANITIZATION |
| **MODIFY** | `src/services/pipeline/types.ts` | Add `existingProfile?: VoiceProfileFile` to PipelineContext |
| **MODIFY** | `src/components/convert/VoiceReviewModal.tsx` | Use `importProfile()`, `readJSONFile()`, `randomizeBelowVoices()` from VoiceProfile.ts |
| **MODIFY** | `src/state/types.ts` | Remove any v1-specific types if present |

## 8. Implementation Checklist

- [ ] Move `randomizeBelowVoices`, `sortVoicesByPriority`, `downloadJSON`, `readJSONFile` to `VoiceProfile.ts`
- [ ] Update `importProfile()` to reject `version !== 2` with error message
- [ ] Delete `VoiceMappingService.ts` and `VoiceMappingService.test.ts`
- [ ] Update `SaveStep.ts`: use `exportToProfile()`, clear `dropsContextKeys`
- [ ] Move SAVE step in `PipelineBuilder.ts` to before TEXT_SANITIZATION
- [ ] Add `existingProfile?: VoiceProfileFile` to `PipelineContext`
- [ ] Update `VoiceReviewModal.tsx`: import from `VoiceProfile.ts`, use `importProfile()`
- [ ] Update `VoiceReviewModal.tsx`: show error message on v1 import attempt
- [ ] Pass loaded profile through context for cumulative export
- [ ] Add/update tests for consolidated `VoiceProfile.ts`
- [ ] Verify resume flow works (profile saved before TTS, pipeline_state.json unchanged)
- [ ] Remove any stale imports referencing `VoiceMappingService`
