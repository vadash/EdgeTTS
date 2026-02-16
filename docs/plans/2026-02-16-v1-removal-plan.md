# Implementation Plan - Remove v1 Voice Mapping Format

> **Reference:** `docs/designs/2026-02-16-v1-removal-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Move format-agnostic utilities to VoiceProfile.ts

**Goal:** Move `sortVoicesByPriority`, `randomizeBelowVoices`, `downloadJSON`, `readJSONFile`, and `RandomizeBelowParams` type from `VoiceMappingService.ts` to `VoiceProfile.ts`.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts`
- Add at the bottom of the file:
  ```typescript
  describe('Module exports (moved utilities)', () => {
    it('exports moved utility functions', async () => {
      const module = await import('./VoiceProfile');

      expect(typeof module.sortVoicesByPriority).toBe('function');
      expect(typeof module.randomizeBelowVoices).toBe('function');
      expect(typeof module.downloadJSON).toBe('function');
      expect(typeof module.readJSONFile).toBe('function');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/VoiceProfile.test.ts`
- Expect: Fail — `sortVoicesByPriority` etc. not exported from VoiceProfile.

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- Action: Copy these functions and types from `VoiceMappingService.ts` to the bottom of `VoiceProfile.ts`:
  1. Add import: `import type { DetectedLanguage } from '@/utils/languageDetection';`
  2. Copy `RandomizeBelowParams` interface (lines ~30-42 of VoiceMappingService.ts)
  3. Copy `sortVoicesByPriority()` function (lines ~313-340)
  4. Copy `randomizeBelowVoices()` function (lines ~345-394)
  5. Copy `downloadJSON()` function (lines ~292-300)
  6. Copy `readJSONFile()` function (lines ~305-308)

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/VoiceProfile.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat: move format-agnostic utilities to VoiceProfile.ts"`

---

### Task 2: Move utility tests to VoiceProfile.test.ts

**Goal:** Move `sortVoicesByPriority` and `randomizeBelowVoices` tests from `VoiceMappingService.test.ts` to `VoiceProfile.test.ts`.

**Step 1: Copy tests**
- File: `src/services/llm/VoiceProfile.test.ts`
- Action: Copy the `describe('sortVoicesByPriority', ...)` and `describe('randomizeBelowVoices', ...)` blocks from `src/services/VoiceMappingService.test.ts` into `VoiceProfile.test.ts`.
- Update imports to pull from `'./VoiceProfile'` instead of `'../VoiceMappingService'`.
- Import `RandomizeBelowParams` from `'./VoiceProfile'`.

**Step 2: Verify**
- Command: `npx vitest run src/services/llm/VoiceProfile.test.ts`
- Expect: PASS — all moved tests pass against new location.

**Step 3: Git Commit**
- `git add . && git commit -m "test: move utility tests to VoiceProfile.test.ts"`

---

### Task 3: Add v1 rejection to importProfile

**Goal:** `importProfile()` should throw a clear error when given a v1 JSON file.

**Step 1: Write the Failing Test**
- File: `src/services/llm/VoiceProfile.test.ts`
- Add inside the existing `describe('importProfile', ...)` block:
  ```typescript
  it('throws on v1 format with clear error message', () => {
    const v1Json = JSON.stringify({
      version: 1,
      narrator: 'en-US, GuyNeural',
      voices: [{ name: 'Harry', voice: 'en-GB-RyanNeural', gender: 'male' }]
    });

    expect(() => {
      importProfile(v1Json, []);
    }).toThrow('Unsupported voice profile format. Re-export from a current session.');
  });

  it('throws on missing version field', () => {
    const noVersionJson = JSON.stringify({
      narrator: 'en-US, GuyNeural',
      characters: {}
    });

    expect(() => {
      importProfile(noVersionJson, []);
    }).toThrow('Unsupported voice profile format');
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run src/services/llm/VoiceProfile.test.ts`
- Expect: Fail — importProfile currently does not check version.

**Step 3: Implementation (Green)**
- File: `src/services/llm/VoiceProfile.ts`
- In `importProfile()`, add version check right after `JSON.parse`:
  ```typescript
  export function importProfile(
    profileJson: string,
    currentCharacters: LLMCharacter[]
  ): { ... } {
    const profile = JSON.parse(profileJson);

    if (profile.version !== 2) {
      throw new Error('Unsupported voice profile format. Re-export from a current session.');
    }

    // ... rest of existing code, cast profile as VoiceProfileFile
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run src/services/llm/VoiceProfile.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add . && git commit -m "feat: reject v1 format in importProfile with clear error"`

---

### Task 4: Add existingProfile to PipelineContext

**Goal:** Add `existingProfile?: VoiceProfileFile` to `PipelineContext` so SaveStep can produce cumulative v2 profiles.

**Step 1: Implementation**
- File: `src/services/pipeline/types.ts`
- Add import at top: `import type { VoiceProfileFile } from '@/state/types';`
- Add to `PipelineContext` interface, after the `directoryHandle` field:
  ```typescript
  // Loaded voice profile (for cumulative series export)
  existingProfile?: VoiceProfileFile | null;
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS — adding an optional field is backward compatible.

**Step 3: Git Commit**
- `git add . && git commit -m "feat: add existingProfile to PipelineContext"`

---

### Task 5: Update SaveStep to use exportToProfile

**Goal:** Replace `exportToJSONSorted` with `exportToProfile` in SaveStep. Clear `dropsContextKeys` so TTS data persists.

**Step 1: Implementation**
- File: `src/services/pipeline/steps/SaveStep.ts`
- Replace import:
  ```typescript
  // Before:
  import { exportToJSONSorted } from '@/services/VoiceMappingService';

  // After:
  import { exportToProfile } from '@/services/llm/VoiceProfile';
  ```
- Clear `dropsContextKeys`:
  ```typescript
  // Before:
  readonly dropsContextKeys: (keyof PipelineContext)[] = ['assignments', 'characters', 'voiceMap'];

  // After:
  readonly dropsContextKeys: (keyof PipelineContext)[] = [];
  ```
- Replace the JSON export line inside `execute()`:
  ```typescript
  // Before:
  const json = exportToJSONSorted(characters, voiceMap, assignments, this.options.narratorVoice);

  // After:
  const json = exportToProfile(
    context.existingProfile ?? null,
    characters,
    voiceMap,
    assignments,
    this.options.narratorVoice,
    bookName
  );
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS — SaveStep no longer references VoiceMappingService.

**Step 3: Git Commit**
- `git add . && git commit -m "feat: SaveStep uses v2 exportToProfile"`

---

### Task 6: Move SaveStep before TTS in pipeline

**Goal:** Reorder pipeline so SAVE runs right after voice review (before TEXT_SANITIZATION), so profile is on disk before TTS starts.

**Step 1: Implementation**
- File: `src/services/pipeline/PipelineBuilder.ts`
- In the `build()` method, move `SAVE` step. Change from:
  ```typescript
    const config = builder
      .addStep(StepNames.TEXT_SANITIZATION, {})
      .addStep(StepNames.DICTIONARY_PROCESSING, { ... })
      .addStep(StepNames.TTS_CONVERSION, { ... })
      .addStep(StepNames.AUDIO_MERGE, { ... })
      .addStep(StepNames.SAVE, {
        narratorVoice: options.narratorVoice,
      })
      .addStep(StepNames.CLEANUP, { ... })
      .build();
  ```
  To:
  ```typescript
    const config = builder
      .addStep(StepNames.SAVE, {
        narratorVoice: options.narratorVoice,
      })
      .addStep(StepNames.TEXT_SANITIZATION, {})
      .addStep(StepNames.DICTIONARY_PROCESSING, { ... })
      .addStep(StepNames.TTS_CONVERSION, { ... })
      .addStep(StepNames.AUDIO_MERGE, { ... })
      .addStep(StepNames.CLEANUP, { ... })
      .build();
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS

**Step 3: Git Commit**
- `git add . && git commit -m "feat: move SaveStep before TTS in pipeline order"`

---

### Task 7: Update VoiceReviewModal to use VoiceProfile imports

**Goal:** Replace all `VoiceMappingService` imports in `VoiceReviewModal.tsx` with `VoiceProfile` imports.

**Step 1: Implementation**
- File: `src/components/convert/VoiceReviewModal.tsx`
- Replace import block:
  ```typescript
  // Before:
  import {
    importFromJSON,
    applyImportedMappings,
    readJSONFile,
    randomizeBelowVoices,
  } from '@/services/VoiceMappingService';

  // After:
  import {
    importProfile,
    readJSONFile,
    randomizeBelowVoices,
  } from '@/services/llm/VoiceProfile';
  ```
- Replace `handleImportFile` function body:
  ```typescript
  const handleImportFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      setImportError(null);
      const json = await readJSONFile(file);
      const { voiceMap: importedMap, matchedCharacters, unmatchedCharacters } = importProfile(json, characters);

      // Merge imported voices into current map
      const newMap = new Map(voiceMap);
      for (const [name, voice] of importedMap) {
        newMap.set(name, voice);
      }
      llm.setVoiceMap(newMap);

      const matchCount = matchedCharacters.size;
      const unmatchCount = unmatchedCharacters.length;
      logs.info(`Imported voices: ${matchCount} matched, ${unmatchCount} unmatched from ${file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportError(message);
      logs.error(`Failed to import voice profile: ${message}`);
    }

    input.value = '';
  };
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS — no tests directly test VoiceReviewModal, but build should pass.

**Step 3: Git Commit**
- `git add . && git commit -m "feat: VoiceReviewModal uses v2 importProfile"`

---

### Task 8: Delete VoiceMappingService

**Goal:** Delete `VoiceMappingService.ts` and `VoiceMappingService.test.ts`. Verify no remaining references.

**Step 1: Check for remaining imports**
- Command: `npx grep -r "VoiceMappingService" src/`
- Expect: Zero results (all references updated in prior tasks).

**Step 2: Delete files**
- Delete `src/services/VoiceMappingService.ts`
- Delete `src/services/VoiceMappingService.test.ts`

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: PASS — no broken imports.

**Step 4: Git Commit**
- `git add . && git commit -m "feat: delete VoiceMappingService (v1 format removed)"`

---

### Task 9: Wire existingProfile through VoiceReviewModal

**Goal:** When user imports a v2 profile in VoiceReviewModal, store the parsed profile so it flows through PipelineContext to SaveStep for cumulative merge.

**Step 1: Implementation**
- File: `src/stores/LLMStore.ts`
- Add a signal for the loaded profile:
  ```typescript
  import type { VoiceProfileFile } from '@/state/types';
  // In the store class, add:
  readonly loadedProfile = signal<VoiceProfileFile | null>(null);
  setLoadedProfile(profile: VoiceProfileFile | null): void {
    this.loadedProfile.value = profile;
  }
  ```

- File: `src/components/convert/VoiceReviewModal.tsx`
- In `handleImportFile`, after successful import, parse the profile and store it:
  ```typescript
  // After the importProfile call succeeds:
  const parsed = JSON.parse(json) as VoiceProfileFile;
  llm.setLoadedProfile(parsed);
  ```
  - Add import: `import type { VoiceProfileFile } from '@/state/types';`

- File: `src/services/ConversionOrchestrator.ts`
- In the pause callback (after voice review), pass the loaded profile into context:
  ```typescript
  // After getting reviewedVoiceMap, add:
  const existingProfile = this.stores.llm.loadedProfile.value;

  return {
    ...ctx,
    voiceMap: reviewedVoiceMap,
    assignments: remappedAssignments,
    existingProfile,
  };
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS

**Step 3: Git Commit**
- `git add . && git commit -m "feat: wire existingProfile from VoiceReviewModal through pipeline to SaveStep"`

---

### Task 10: Remove savedFileCount from SaveStep

**Goal:** SaveStep previously reported `savedFileCount` for audio files. Since it now runs before TTS, remove audio count reporting. Update the progress message.

**Step 1: Implementation**
- File: `src/services/pipeline/steps/SaveStep.ts`
- In `execute()`, remove the line:
  ```typescript
  // Delete this line:
  const { savedFileCount, directoryHandle, characters, voiceMap, assignments, fileNames } = context;
  // Replace with:
  const { directoryHandle, characters, voiceMap, assignments, fileNames } = context;
  ```
- Remove the initial progress report about audio files:
  ```typescript
  // Delete this line:
  this.reportProgress(1, 1, `${savedFileCount ?? 0} audio file(s) saved`);
  ```

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: PASS

**Step 3: Git Commit**
- `git add . && git commit -m "refactor: remove audio file count from SaveStep (now runs before TTS)"`

---

### Task 11: Full integration verification

**Goal:** Run all tests, verify no stale references to v1 format.

**Step 1: Search for stale references**
- Command: `npx grep -r "VoiceMappingService\|VoiceMappingFile\|VoiceMappingEntry\|exportToJSON\b\|importFromJSON\|applyImportedMappings\|findMatchingEntry\|normalizeForMatch\|MIN_SPEAKING_PERCENTAGE" src/`
- Expect: Zero results.

**Step 2: Run full test suite**
- Command: `npx vitest run`
- Expect: All tests PASS.

**Step 3: Build check**
- Command: `npm run build`
- Expect: No TypeScript errors.

**Step 4: Git Commit**
- `git add . && git commit -m "chore: verify v1 removal complete, all tests pass"`
