# Design: Randomize Below Voices

## 1. Problem Statement

When importing JSON voice mappings, multiple characters may get assigned the same voice. Users fix the top characters manually, then need a quick way to randomize all remaining characters below with unused voices.

## 2. Goals & Non-Goals

**Must do:**
- Add 🎲↓ button at end of each character row in Voice Review modal
- Clicking randomizes voices for all characters BELOW that row
- Match gender: male chars → male voices, female chars → female voices
- Reserve narrator voice (from settings) from auto-assignment
- Reserve all voices already assigned to characters ABOVE the clicked row
- If more characters than available voices → cycle through (round-robin)
- Sort available voices: book language voices first, then multilingual, then narrator (reserved but at top for manual pick), then rest

**Won't do:**
- Randomize characters above the clicked row
- Auto-detect gender from names
- Smart voice similarity matching

## 3. Proposed Architecture

### File Changes

1. **`src/services/VoiceMappingService.ts`** - Add `randomizeBelowVoices()` function
2. **`src/components/convert/VoiceReviewModal.tsx`** - Add button and call service

### Voice Sorting Priority

When building the available voice pool:
1. **Book language voices** (e.g., `en-*` if book is English)
2. **Multilingual voices** (voices that work across languages, if any)
3. **Narrator voice** (from settings) - visible in dropdown but excluded from random assignment
4. **Other enabled voices** (sorted alphabetically)

## 4. Data Models / Schema

### Input to `randomizeBelowVoices()`

```typescript
interface RandomizeBelowParams {
  // All characters sorted by line count (descending)
  sortedCharacters: LLMCharacter[];
  // Current voice map
  currentVoiceMap: Map<string, string>;
  // Index of the row where button was clicked (randomize BELOW this)
  clickedIndex: number;
  // Enabled voices from settings
  enabledVoices: VoiceOption[];
  // Narrator voice to reserve (from settings.voice)
  narratorVoice: string;
  // Detected book language ('en' | 'ru')
  bookLanguage: DetectedLanguage;
}
```

### Output

```typescript
// Returns new Map<string, string> with updated voice assignments
```

## 5. Interface / API Design

### VoiceMappingService.ts

```typescript
/**
 * Randomizes voice assignments for characters below a given index
 *
 * Algorithm:
 * 1. Collect voices assigned to characters at indices 0..clickedIndex (reserved)
 * 2. Add narrator voice to reserved set
 * 3. Filter enabled voices: remove reserved, sort by priority
 * 4. For each character below clickedIndex:
 *    - Filter voices by matching gender
 *    - Pick next voice from filtered pool (cycle if exhausted)
 *    - Mark voice as used
 * 5. Return new voice map
 */
export function randomizeBelowVoices(params: RandomizeBelowParams): Map<string, string>;

/**
 * Sorts voices by priority for randomization
 * Priority: book language > multilingual > rest (alphabetical)
 */
export function sortVoicesByPriority(
  voices: VoiceOption[],
  bookLanguage: DetectedLanguage,
  narratorVoice: string
): VoiceOption[];
```

### VoiceReviewModal.tsx

```tsx
// New handler
const handleRandomizeBelow = (clickedIndex: number) => {
  const newMap = randomizeBelowVoices({
    sortedCharacters,
    currentVoiceMap: voiceMap,
    clickedIndex,
    enabledVoices: voices.filter(v => enabledVoices.includes(v.fullValue)),
    narratorVoice: settings.voice.value,
    bookLanguage: data.detectedLanguage.value,
  });
  llm.setVoiceMap(newMap);
};

// Button in each row (after preview button)
<button
  className="btn btn-sm px-2"
  onClick={() => handleRandomizeBelow(index)}
  title="Randomize voices below"
>
  🎲↓
</button>
```

## 6. Risks & Edge Cases

| Scenario | Handling |
|----------|----------|
| No characters below clicked row | Button does nothing (noop) |
| All voices already used above | Cycle through available voices for below characters |
| Character has unknown gender | Treat as male (or use any available voice) |
| 0 male voices but male character needs one | Use any available voice from other gender |
| User clicks on last row | Button still shown but does nothing |
| Book language not detected | Default to 'en' (from DataStore default) |

## 7. UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│ Voice Review                                            ✕   │
├─────────────────────────────────────────────────────────────┤
│ Sample text: [Hello, I am testing this voice.           ]   │
├─────────────────────────────────────────────────────────────┤
│ Character          │ Voice                    │   │         │
├────────────────────┼──────────────────────────┼───┼─────────┤
│ Narrator       M   │ [en-US-GuyNeural     ▼]  │ ▶ │ 🎲↓     │
│ Alice          F   │ [en-US-JennyNeural   ▼]  │ ▶ │ 🎲↓     │
│ Bob            M   │ [en-US-TonyNeural    ▼]  │ ▶ │ 🎲↓     │  ← click here
│ Carol          F   │ [en-US-AriaNeural    ▼]  │ ▶ │ 🎲↓     │  ← randomized
│ Dave           M   │ [en-US-DavisNeural   ▼]  │ ▶ │ 🎲↓     │  ← randomized
└─────────────────────────────────────────────────────────────┘
```

## 8. Implementation Checklist

- [ ] Add `randomizeBelowVoices()` to VoiceMappingService.ts
- [ ] Add `sortVoicesByPriority()` helper
- [ ] Add 🎲↓ button to VoiceReviewModal.tsx
- [ ] Wire up click handler
- [ ] Add unit tests for randomization logic
- [ ] Test with edge cases (no voices, all same gender, etc.)
