# Implementation Plan - Voice Review Pipeline Reorder

> **Reference:** `docs/designs/2026-01-29-voice-review-pipeline-reorder-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add speakerAssignments to LLMStore

**Goal:** Store speaker assignments in LLMStore so VoiceReviewModal can compute line counts.

**Step 1: Write the Failing Test**
- File: `src/stores/LLMStore.test.ts`
- Code (append to end of file, before final `}`):
  ```typescript
  describe('speakerAssignments', () => {
    it('starts with empty assignments', () => {
      expect(store.speakerAssignments.value).toEqual([]);
    });

    it('sets speaker assignments', () => {
      const assignments = [
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
        { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'voice-2' },
      ];
      store.setSpeakerAssignments(assignments);
      expect(store.speakerAssignments.value).toEqual(assignments);
    });

    it('resets assignments on resetProcessingState', () => {
      store.setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'voice-1' },
      ]);
      store.resetProcessingState();
      expect(store.speakerAssignments.value).toEqual([]);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/LLMStore.test.ts`
- Expect: "Property 'speakerAssignments' does not exist"

**Step 3: Implementation (Green)**
- File: `src/stores/LLMStore.ts`
- Action 1: Add import at top:
  ```typescript
  import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
  ```
- Action 2: Add signal after `characterVoiceMap`:
  ```typescript
  readonly speakerAssignments = signal<SpeakerAssignment[]>([]);
  ```
- Action 3: Add method after `removeVoiceMapping`:
  ```typescript
  setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
    this.speakerAssignments.value = assignments;
  }
  ```
- Action 4: In `resetProcessingState()`, add:
  ```typescript
  this.speakerAssignments.value = [];
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/LLMStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(llm-store): add speakerAssignments signal"`

---

## Task 2: Add characterLineCounts computed property

**Goal:** Compute line counts per character from speaker assignments.

**Step 1: Write the Failing Test**
- File: `src/stores/LLMStore.test.ts`
- Code (append inside `describe('speakerAssignments')`):
  ```typescript
  describe('characterLineCounts', () => {
    it('returns empty map when no assignments', () => {
      expect(store.characterLineCounts.value.size).toBe(0);
    });

    it('counts lines per character', () => {
      store.setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Hello', speaker: 'John', voiceId: 'v1' },
        { sentenceIndex: 1, text: 'Hi', speaker: 'Mary', voiceId: 'v2' },
        { sentenceIndex: 2, text: 'Hey', speaker: 'John', voiceId: 'v1' },
        { sentenceIndex: 3, text: 'Yo', speaker: 'John', voiceId: 'v1' },
      ]);
      const counts = store.characterLineCounts.value;
      expect(counts.get('John')).toBe(3);
      expect(counts.get('Mary')).toBe(1);
    });

    it('excludes narrator from counts', () => {
      store.setSpeakerAssignments([
        { sentenceIndex: 0, text: 'Narration', speaker: 'narrator', voiceId: 'v0' },
        { sentenceIndex: 1, text: 'Hello', speaker: 'John', voiceId: 'v1' },
      ]);
      const counts = store.characterLineCounts.value;
      expect(counts.has('narrator')).toBe(false);
      expect(counts.get('John')).toBe(1);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/LLMStore.test.ts`
- Expect: "Property 'characterLineCounts' does not exist"

**Step 3: Implementation (Green)**
- File: `src/stores/LLMStore.ts`
- Action: Add computed property after `characterNames`:
  ```typescript
  /**
   * Get line counts per character
   */
  readonly characterLineCounts = computed(() => {
    const assignments = this.speakerAssignments.value;
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (a.speaker !== 'narrator') {
        counts.set(a.speaker, (counts.get(a.speaker) ?? 0) + 1);
      }
    }
    return counts;
  });
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/LLMStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(llm-store): add characterLineCounts computed"`

---

## Task 3: Move pause callback to VOICE_REMAPPING

**Goal:** Change ConversionOrchestrator to pause after VoiceRemapping instead of VoiceAssignment.

**Step 1: Write the Failing Test**
- File: `src/services/ConversionOrchestrator.test.ts` (if exists, otherwise skip test step)
- Note: This is integration-level change. Manual verification preferred.

**Step 2: Run Test (Red)**
- Skip if no test file exists.

**Step 3: Implementation (Green)**
- File: `src/services/ConversionOrchestrator.ts`
- Action 1: Change line ~125 from:
  ```typescript
  pipeline.setPauseCallback(StepNames.VOICE_ASSIGNMENT, async (ctx: PipelineContext) => {
  ```
  to:
  ```typescript
  pipeline.setPauseCallback(StepNames.VOICE_REMAPPING, async (ctx: PipelineContext) => {
  ```
- Action 2: Add assignments storage inside the callback, after `setVoiceMap`:
  ```typescript
  if (ctx.assignments) {
    this.stores.llm.setSpeakerAssignments(ctx.assignments);
  }
  ```
- Action 3: Add re-remap logic before returning context. Replace the return statement with:
  ```typescript
  // Get the (potentially modified) voice map from the store
  const reviewedVoiceMap = this.stores.llm.characterVoiceMap.value;

  // Re-remap assignments with user's voice choices
  const remappedAssignments = ctx.assignments?.map(a => ({
    ...a,
    voiceId: a.speaker === 'narrator'
      ? this.stores.settings.narratorVoice.value
      : reviewedVoiceMap.get(a.speaker) ?? this.stores.settings.narratorVoice.value,
  }));

  // Return context with updated voice map and re-mapped assignments
  return {
    ...ctx,
    voiceMap: reviewedVoiceMap,
    assignments: remappedAssignments,
  };
  ```

**Step 4: Verify (Green)**
- Command: `npm run type-check`
- Expect: No TypeScript errors

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(orchestrator): move voice review to after remapping"`

---

## Task 4: Update VoiceReviewModal sorting

**Goal:** Sort characters by line count instead of variations.length.

**Step 1: Write the Failing Test**
- Note: UI component testing is complex. Manual verification preferred.

**Step 2: Run Test (Red)**
- Skip.

**Step 3: Implementation (Green)**
- File: `src/components/convert/VoiceReviewModal.tsx`
- Action 1: Get line counts from store. After `const voiceMap = llm.characterVoiceMap.value;`, add:
  ```typescript
  const lineCounts = llm.characterLineCounts.value;
  ```
- Action 2: Change sorting logic from:
  ```typescript
  const sortedCharacters = [...characters].sort(
    (a, b) => b.variations.length - a.variations.length
  );
  ```
  to:
  ```typescript
  const sortedCharacters = [...characters].sort((a, b) => {
    const countA = lineCounts.get(a.canonicalName) ?? 0;
    const countB = lineCounts.get(b.canonicalName) ?? 0;
    return countB - countA;
  });
  ```

**Step 4: Verify (Green)**
- Command: `npm run type-check`
- Expect: No TypeScript errors

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-review): sort by line count"`

---

## Task 5: Add line count badge to VoiceReviewModal

**Goal:** Display line count badge next to character name.

**Step 1: Write the Failing Test**
- Skip (UI component).

**Step 2: Run Test (Red)**
- Skip.

**Step 3: Implementation (Green)**
- File: `src/components/convert/VoiceReviewModal.tsx`
- Action: In the table row, change from:
  ```tsx
  <td className="py-2 pr-2">
    <span className="font-medium">{char.canonicalName}</span>
    <span className="ml-2 text-gray-500">{genderSymbol(char.gender)}</span>
  </td>
  ```
  to:
  ```tsx
  <td className="py-2 pr-2">
    <span className="font-medium">{char.canonicalName}</span>
    <span className="ml-2 text-gray-500">{genderSymbol(char.gender)}</span>
    <span className="ml-2 text-xs text-gray-400 bg-surface-alt px-1.5 py-0.5 rounded">
      {lineCounts.get(char.canonicalName) ?? 0}
    </span>
  </td>
  ```

**Step 4: Verify (Green)**
- Command: `npm run type-check`
- Expect: No TypeScript errors

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat(voice-review): add line count badge"`

---

## Task 6: Manual Integration Test

**Goal:** Verify end-to-end flow works correctly.

**Step 1: Start dev server**
- Command: `npm run dev`

**Step 2: Test flow**
1. Load a text file with dialogue
2. Start conversion
3. Wait for LLM extraction and assignment to complete
4. Verify VoiceReviewModal appears with:
   - Characters sorted by line count (highest first)
   - Line count badge visible next to each character name
5. Change a voice assignment
6. Click Continue
7. Verify TTS uses the changed voice

**Step 3: Verify**
- Expect: All steps complete without errors

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat: voice review shows line counts (pipeline reorder)"`

---

## Summary

| Task | Files Modified | Commit Message |
|------|----------------|----------------|
| 1 | LLMStore.ts, LLMStore.test.ts | feat(llm-store): add speakerAssignments signal |
| 2 | LLMStore.ts, LLMStore.test.ts | feat(llm-store): add characterLineCounts computed |
| 3 | ConversionOrchestrator.ts | feat(orchestrator): move voice review to after remapping |
| 4 | VoiceReviewModal.tsx | feat(voice-review): sort by line count |
| 5 | VoiceReviewModal.tsx | feat(voice-review): add line count badge |
| 6 | (none - manual test) | feat: voice review shows line counts (pipeline reorder) |
