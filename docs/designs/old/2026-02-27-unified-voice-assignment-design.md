# Design: Unified Voice Assignment with DRY Priority Pool

## 1. Problem Statement

Three code paths assign voices to characters, each with different (broken) ordering logic:

| Path | File | Dedup? | Priority order? | Bug |
|------|------|--------|-----------------|-----|
| Initial allocation | `VoicePoolBuilder.ts` → `VoiceAllocator.ts` | ✅ `deduplicateVariants` | ❌ `pickVoice` uses `Math.random()` | Multilingual voice at position 5 despite 20+ native voices |
| Randomize below | `VoiceAllocator.ts:sortVoicesByPriority` | ❌ | ⚠️ language-first only, no multilingual-last | Both AndrewNeural + AndrewMultilingualNeural survive; multilingual interspersed alphabetically |
| JSON import | `VoiceProfile.ts:importProfile` | ❌ | ❌ | Unmatched characters keep whatever random voice they had |

### Root causes

1. **`VoicePoolTracker.pickVoice()`** (`VoiceAllocator.ts:72`) picks randomly from available voices via `Math.random()`, discarding the careful ordering from `deduplicateVariants()`.
2. **`sortVoicesByPriority()`** (`VoiceAllocator.ts:281-300`) is a separate, incomplete implementation — no dedup, no multilingual-last sorting.
3. **`importProfile()`** does no re-allocation for unmatched characters at all.

## 2. Goals & Non-Goals

### Must do
- Single shared function for voice assignment used by all 3 paths (DRY)
- Sequential (not random) picks from priority-ordered pool
- Dedup + multilingual-last ordering in all paths
- JSON import: reassign unmatched characters from priority pool
- JSON import: replace imported voices not in enabled list from priority pool

### Won't do
- Change `VoiceOption` or `VoicePool` interfaces
- Change the UI layout of Voice Review modal
- Change JSON profile format

## 3. Proposed Architecture

All 3 paths reduce to one operation with different "frozen" assignments:

```
assignFromPool(characters, frozenVoices, pool, bookLanguage)
```

| Path | frozenVoices |
|------|-------------|
| Initial allocation | `{ narrator }` |
| Randomize below | `{ narrator, voices above clicked row }` |
| JSON import | `{ narrator, matched characters with valid voices }` |

### Shared pipeline

```
1. Build priority pool:
   a. Filter by language + includeMultilingual (existing buildVoicePool logic)
   b. deduplicateVariants() — resolve pairs, sort non-multi first

2. Reserve frozen voices (remove from available pool)

3. For each unassigned character (in order):
   Pick first available voice from gender-appropriate pool (sequential, not random)
```

### Key change: `pickVoice` becomes sequential

```typescript
// BEFORE (broken):
const voice = available[Math.floor(Math.random() * available.length)];

// AFTER (respects pool ordering):
const voice = available[0];
```

The pool is already ordered by priority (native non-multilingual → native multilingual → foreign multilingual). Random selection defeats this ordering.

## 4. Data Models / Schema

No changes to existing types. The design introduces no new interfaces.

## 5. Interface / API Design

### Replace `sortVoicesByPriority` with `buildPriorityPool`

The existing `sortVoicesByPriority` in `VoiceAllocator.ts` is replaced by a function that reuses `deduplicateVariants`:

```typescript
/**
 * Build a priority-ordered, deduplicated voice pool.
 * Used by all voice assignment paths (initial, randomize, JSON import).
 *
 * Order: native non-Multilingual → native Multilingual → foreign Multilingual
 * Dedup: variant pairs resolved (only one of Andrew/AndrewMultilingual survives)
 */
export function buildPriorityPool(
  voices: VoiceOption[],
  bookLanguage: string,
  reserved: Set<string>,
): { male: VoiceOption[]; female: VoiceOption[] }
```

Steps inside:
1. Filter out reserved voices
2. Call `deduplicateVariants(voices, bookLanguage)` — already exists in `VoicePoolBuilder.ts`
3. Return split by gender

### Update `randomizeBelow` to use `buildPriorityPool`

```typescript
// BEFORE:
const prioritized = sortVoicesByPriority(enabledVoices, bookLanguage, narratorVoice);

// AFTER:
const pool = buildPriorityPool(enabledVoices, bookLanguage, reserved);
const malePool = pool.male.filter((v) => !reserved.has(v.fullValue));
const femalePool = pool.female.filter((v) => !reserved.has(v.fullValue));
```

### Update `importProfile` return + caller handles unmatched

`importProfile` stays focused on matching. The caller (`VoiceReviewModal.handleImportFile`) handles unmatched characters:

```typescript
const { voiceMap: importedMap, matchedCharacters, unmatchedCharacters } = importProfile(json, characters);

// Validate imported voices against enabled list
for (const [name, voice] of importedMap) {
  if (!enabledVoices.includes(voice)) {
    importedMap.delete(name);
    unmatchedCharacters.push(name);
  }
}

// Build reserved set from valid imports + narrator
const reserved = new Set<string>([narratorVoice, ...importedMap.values()]);

// Assign unmatched from priority pool
const pool = buildPriorityPool(enabledVoiceOptions, bookLanguage, reserved);
// ... sequential assignment for unmatched characters
```

### Update `VoicePoolTracker.pickVoice` — sequential

```typescript
pickVoice(gender: 'male' | 'female' | 'unknown'): string {
  // ... pool selection unchanged ...

  const available = pool.filter((v) => !this.used.has(v));
  if (available.length > 0) {
    const voice = available[0]; // Sequential, not random
    this.used.add(voice);
    return voice;
  }

  // Fallback: cycle through pool (reuse)
  return pool[this.cycleIndex++ % pool.length];
}
```

## 6. Risks & Edge Cases

### Edge case: JSON has voice not in enabled list
Decision: **Replace with pool voice**. The character is treated as unmatched and gets the next available voice from the priority pool. Import summary log reports this.

### Edge case: JSON has more matched characters than available pool voices
Same as current pool exhaustion — cycle/reuse voices. No special handling needed.

### Edge case: All characters matched from JSON
No unmatched characters → no pool assignment needed. `buildPriorityPool` is still called (cheap) but produces no assignments. Clean no-op.

### Edge case: Randomize below with index 0
All characters below index 0 get reassigned. Frozen set = narrator only. Equivalent to full re-allocation.

### Risk: Removing randomness from pickVoice
Users may notice that the same book always gets the same voice assignments. This is **correct behavior** — deterministic assignment means consistent results. If randomness is desired, the user clicks "Randomize below" on the first row.

### Risk: deduplicateVariants imported across modules
`deduplicateVariants` lives in `VoicePoolBuilder.ts`. `buildPriorityPool` lives in `VoiceAllocator.ts`. Need to export `deduplicateVariants` (it's already exported based on current code).

## 7. Implementation Checklist

1. **Export `deduplicateVariants`** from `VoicePoolBuilder.ts` (if not already)
2. **Add `buildPriorityPool`** in `VoiceAllocator.ts` — wraps `deduplicateVariants` + splits by gender
3. **Change `pickVoice`** — `available[0]` instead of `Math.random()`
4. **Replace `sortVoicesByPriority`** with `buildPriorityPool` in `randomizeBelow`
5. **Update `handleImportFile`** in `VoiceReviewModal.tsx`:
   - Validate imported voices against enabled list
   - Reassign unmatched characters via `buildPriorityPool` + sequential pick
6. **Delete `sortVoicesByPriority`** (dead code after step 4)
7. **Verify** all 3 paths produce correct ordering with tests

## 8. Supersedes

This design supersedes the "Won't do" item in `2026-02-27-voice-pool-language-aware-design.md`:
> - Change the VoiceAllocator (it just consumes ordered arrays)

The VoiceAllocator *does* need changes — `pickVoice` must be sequential, and `sortVoicesByPriority` must be replaced with the shared `buildPriorityPool`.
