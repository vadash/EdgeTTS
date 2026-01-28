# Design: Voice Review Pipeline Reorder

## 1. Problem Statement

The VoiceReviewModal currently appears **after VoiceAssignmentStep** but **before SpeakerAssignmentStep**. At this point, line counts per character are unknown because the LLM hasn't assigned speakers to lines yet.

Users cannot sort characters by importance (most lines = most important), making it hard to prioritize which characters get unique voices.

## 2. Goals & Non-Goals

### Must do:
- Display accurate line counts in VoiceReviewModal
- Sort characters by line count (descending)
- Show line count as badge next to character name

### Won't do:
- Character merge review (double-pause) - punted for now
- Cheap heuristic approach (regex counting)
- Modify VoiceRemapping logic itself

## 3. Proposed Architecture

**Move the pause callback from `VOICE_ASSIGNMENT` to `VOICE_REMAPPING`.**

Current pipeline order:
```
Extract → Merge → VoiceAssignment → [PAUSE] → SpeakerAssignment → VoiceRemapping → TTS → ...
```

New pipeline order:
```
Extract → Merge → VoiceAssignment → SpeakerAssignment → VoiceRemapping → [PAUSE] → TTS → ...
```

After VoiceRemapping:
1. `assignments` contains all lines with speaker attribution (includes line counts)
2. `voiceMap` has been intelligently assigned by frequency
3. User reviews the pre-sorted, pre-assigned voices and tweaks as needed

## 4. Data Models / Schema

### LLMStore additions

```typescript
// New state property
readonly speakerAssignments = signal<SpeakerAssignment[]>([]);

// New computed property
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

### SpeakerAssignment (existing type, no changes)

```typescript
interface SpeakerAssignment {
  index: number;
  text: string;
  speaker: string;
  voiceId: string;
}
```

## 5. Interface / API Design

### ConversionOrchestrator changes

```typescript
// Change pause callback target
pipeline.setPauseCallback(StepNames.VOICE_REMAPPING, async (ctx: PipelineContext) => {
  // Store characters, voice map, AND assignments
  if (ctx.characters) {
    this.stores.llm.setCharacters(ctx.characters);
  }
  if (ctx.voiceMap) {
    this.stores.llm.setVoiceMap(ctx.voiceMap);
  }
  if (ctx.assignments) {
    this.stores.llm.setSpeakerAssignments(ctx.assignments);
  }

  // Trigger review UI and wait
  this.stores.llm.setPendingReview(true);
  await this.stores.llm.awaitReview();

  // Return potentially modified voice map
  return {
    ...ctx,
    voiceMap: this.stores.llm.characterVoiceMap.value,
  };
});
```

### LLMStore new methods

```typescript
setSpeakerAssignments(assignments: SpeakerAssignment[]): void {
  this.speakerAssignments.value = assignments;
}
```

### VoiceReviewModal changes

```typescript
// Get line counts from store
const lineCounts = llm.characterLineCounts.value;

// Sort by line count (descending)
const sortedCharacters = [...characters].sort((a, b) => {
  const countA = lineCounts.get(a.canonicalName) ?? 0;
  const countB = lineCounts.get(b.canonicalName) ?? 0;
  return countB - countA;
});

// In table row, add badge
<span className="font-medium">{char.canonicalName}</span>
<span className="ml-2 text-xs bg-surface-alt px-1.5 py-0.5 rounded">
  {lineCounts.get(char.canonicalName) ?? 0} lines
</span>
```

## 6. Risks & Edge Cases

### Risk: User waits longer
- **Description:** LLM assign step runs before user sees modal
- **Mitigation:** Acceptable tradeoff per user decision. Progress UI already shows "Assigning speakers..."

### Risk: Voice map changes after user review
- **Description:** If user modifies voiceMap, assignments already have old voiceId
- **Mitigation:** VoiceRemapping already handles this - it remaps assignments based on voiceMap. BUT we need to re-remap if user changes voices.
- **Solution:** After user review, if voiceMap changed, re-apply remapping logic to assignments before continuing.

### Risk: Merge mistakes
- **Description:** User realizes "John" and "Johnny" are same person after assignment
- **Mitigation:** Punted per user decision. User must restart if this happens.

### Edge case: No characters detected
- **Description:** Empty character list
- **Behavior:** Modal shows "No characters detected" (already handled)

### Edge case: User cancels review
- **Description:** User clicks Cancel in modal
- **Behavior:** Pipeline cancellation (already handled)

### Edge case: JSON import
- **Description:** User imports voice mappings from JSON file
- **Behavior:** Works unchanged. VoiceReviewModal still has import button. Imported voices override auto-assigned ones. Re-remap applies imported voices to assignments.

## 7. Files to Change

| File | Change |
|------|--------|
| `src/services/ConversionOrchestrator.ts:125` | Change pause callback from `VOICE_ASSIGNMENT` to `VOICE_REMAPPING`, add assignments storage |
| `src/stores/LLMStore.ts` | Add `speakerAssignments` signal, `characterLineCounts` computed, `setSpeakerAssignments()` method |
| `src/components/convert/VoiceReviewModal.tsx` | Sort by line count, add badge display |
| `src/services/pipeline/steps/VoiceRemappingStep.ts` | (Optional) May need to expose re-remap utility if user changes voiceMap |

## 8. Implementation Steps

1. **LLMStore:** Add `speakerAssignments` signal and computed `characterLineCounts`
2. **ConversionOrchestrator:** Move pause callback to `VOICE_REMAPPING`, store assignments
3. **VoiceReviewModal:**
   - Import `characterLineCounts` from store
   - Change sort from `variations.length` to line count
   - Add badge showing line count
4. **Testing:** Verify line counts appear, sorting works, voice changes apply

## 9. Resolved Questions

### Q: Should we re-run VoiceRemapping if user changes voices in review?

**Context:** After VoiceRemapping, each assignment has a `voiceId` field. If user edits voices in the modal, the `voiceMap` updates but `assignment.voiceId` is stale.

**Decision:** Option A - Re-remap in callback.

After user confirms review, loop through all assignments and update `voiceId`:
```typescript
// In pause callback, after awaitReview():
const reviewedVoiceMap = this.stores.llm.characterVoiceMap.value;
const remappedAssignments = ctx.assignments!.map(a => ({
  ...a,
  voiceId: a.speaker === 'narrator'
    ? narratorVoice
    : reviewedVoiceMap.get(a.speaker) ?? narratorVoice,
}));

return {
  ...ctx,
  voiceMap: reviewedVoiceMap,
  assignments: remappedAssignments,
};
```

This keeps TTSConversionStep unchanged.
