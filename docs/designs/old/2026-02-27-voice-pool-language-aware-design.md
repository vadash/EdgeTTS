# Design: Language-Aware Voice Pool with Multilingual Deduplication

## 1. Problem Statement

The voice list (`voices.ts`) is out of sync with `docs/voice-list.txt`. Missing entries include non-Multilingual variants like `AndrewNeural`, `AvaNeural`, `BrianNeural`, `EmmaNeural`.

More critically, voices with both a native and Multilingual variant (e.g., `AndrewNeural` + `AndrewMultilingualNeural`) are **the same speaker**. The system must:

1. **Never assign both variants to different characters** (they sound identical).
2. **Pick the right variant based on book language**:
   - EN book → `AndrewNeural` (Multilingual variant produces odd accents on English dialogue)
   - RU book → `AndrewMultilingualNeural` (non-Multilingual can't speak Russian)
3. **Prioritize native voices over Multilingual** when assigning to characters:
   - EN book: exhaust `en-*` non-Multilingual voices first, then `en-*` Multilingual voices
   - RU book: exhaust `ru-*` voices first (DmitryNeural, SvetlanaNeural), then Multilingual voices

## 2. Goals & Non-Goals

### Must do
- Sync `voices.ts` with `voice-list.txt` (add missing entries)
- Deduplicate variant pairs at pool-build time (auto-detect via name convention)
- Order voice pool: native non-Multilingual → native Multilingual → foreign Multilingual
- Support EN and RU book languages today, extensible to others

### Won't do
- Change the `VoiceOption` interface (no new fields needed — dedup is by naming convention)
- Change the VoiceAllocator (it just consumes ordered arrays)
- Add UI for multilingual preference (runtime behavior, transparent to user)

## 3. Proposed Architecture

### voices.ts — Full mirror of voice-list.txt

Store **both** variants as separate entries. The file becomes a 1:1 mirror of the source list. No metadata, no grouping — just the full list.

```typescript
// Both exist in the array:
v('en-US, AndrewNeural', 'male'),
v('en-US, AndrewMultilingualNeural', 'male'),
```

### VoicePoolBuilder — Language-aware dedup + ordering

The `buildVoicePool()` function gains dedup + priority logic:

1. **Collect candidates**: filter voices by locale prefix (e.g., `en` or `ru`)
2. **Add Multilingual voices** from any locale (when `includeMultilingual=true`)
3. **Deduplicate pairs**: for voices sharing a base name (strip `Multilingual` suffix):
   - If the voice's native locale matches the book language → keep the non-Multilingual variant
   - Otherwise → keep the Multilingual variant
4. **Sort**: non-Multilingual voices first, Multilingual voices last within each gender pool

### Auto-detect variant pairs

```
"AndrewMultilingualNeural" → strip "Multilingual" → base = "AndrewNeural"
```

If both `AndrewNeural` and `AndrewMultilingualNeural` exist in the candidate pool for the same locale, they are a pair. Pick one based on book language.

## 4. Data Models / Schema

No changes to `VoiceOption`:

```typescript
// Unchanged
export interface VoiceOption {
  locale: string;
  name: string;
  fullValue: string;
  gender: 'male' | 'female';
}
```

No changes to `VoicePool`:

```typescript
// Unchanged
export interface VoicePool {
  male: string[];    // ordered: native first, multilingual last
  female: string[];  // ordered: native first, multilingual last
}
```

## 5. Interface / API Design

### `buildVoicePool()` — updated signature (no breaking changes)

```typescript
export function buildVoicePool(options: VoicePoolOptions = {}): VoicePool
```

`VoicePoolOptions` unchanged. The `language` field drives dedup decisions.

### Internal helper: `deduplicateVariants()`

```typescript
/**
 * Given a list of VoiceOptions, deduplicate Multilingual variant pairs.
 * For pairs (e.g., AndrewNeural + AndrewMultilingualNeural in same locale):
 *   - If locale matches book language → keep non-Multilingual
 *   - Otherwise → keep Multilingual
 *
 * Returns voices sorted: non-Multilingual first, Multilingual last.
 */
function deduplicateVariants(
  candidates: VoiceOption[],
  bookLanguage: string
): VoiceOption[]
```

### Dedup algorithm pseudocode

```
1. Build map: baseName → { native?: VoiceOption, multilingual?: VoiceOption }
   - baseName = name.replace('Multilingual', '') (e.g., "AndrewNeural")

2. For each group:
   a. If only one variant exists → keep it
   b. If both exist:
      - voiceIsNative = locale starts with bookLanguage
      - If voiceIsNative → pick native (non-Multilingual) variant
      - Else → pick multilingual variant

3. Sort result: non-Multilingual voices first, Multilingual last
4. Return sorted array
```

### Example: EN book

Pool before dedup:
```
en-US, AndrewNeural          (native, non-multi)
en-US, AndrewMultilingualNeural  (native, multi)
en-US, AriaNeural             (native, non-multi, no pair)
en-US, BrianNeural            (native, non-multi)
en-US, BrianMultilingualNeural   (native, multi)
```

After dedup (book=en):
```
en-US, AndrewNeural           ✓ (pair resolved: native wins for EN)
en-US, AriaNeural             ✓ (no pair)
en-US, BrianNeural            ✓ (pair resolved: native wins for EN)
```

### Example: RU book

Pool before dedup:
```
ru-RU, DmitryNeural           (native, non-multi)
ru-RU, SvetlanaNeural          (native, non-multi)
en-US, AndrewMultilingualNeural  (foreign, multi — included via includeMultilingual)
en-US, AndrewNeural              (foreign, non-multi — included via locale match? NO)
```

Wait — for RU books, `en-US, AndrewNeural` won't be in the candidate pool because it doesn't match `ru` locale. Only `AndrewMultilingualNeural` gets pulled in via `includeMultilingual`. So no pair conflict exists. Dedup is only relevant when both variants land in the pool.

After dedup (book=ru):
```
ru-RU, DmitryNeural            ✓ (native, first priority)
ru-RU, SvetlanaNeural           ✓ (native, first priority)
en-US, AndrewMultilingualNeural ✓ (multilingual, lower priority)
en-US, BrianMultilingualNeural  ✓ (multilingual, lower priority)
...etc
```

## 6. Risks & Edge Cases

### Edge case: Future language with Multilingual voices in same locale
Example: if `de-DE, FlorianMultilingualNeural` has a pair `de-DE, FlorianNeural` added later. The algorithm handles this generically — no special-casing per language.

### Edge case: includeMultilingual=false
When disabled, no Multilingual voices enter the pool, so no dedup needed. Algorithm is a no-op.

### Edge case: enabledVoices allowlist
If user manually enables both `AndrewNeural` and `AndrewMultilingualNeural`, dedup still runs — only one survives. This is correct behavior.

### Edge case: New language support (e.g., French)
Works automatically: `fr-*` native voices first, then Multilingual voices from other locales. No code changes needed per language.

### Risk: Name convention breaks
If Microsoft adds a voice named e.g., `MultilingualBotNeural`, the `name.replace('Multilingual', '')` could misfire. Mitigation: the replace targets `Multilingual` as a substring — this is consistent with all current Edge TTS naming. Monitor voice-list.txt updates.

## 7. Implementation Checklist

1. **Sync `voices.ts`** — add missing entries from `voice-list.txt` (AndrewNeural, AvaNeural, BrianNeural, EmmaNeural)
2. **Add `deduplicateVariants()`** helper in `VoicePoolBuilder.ts`
3. **Update `buildVoicePool()`** — call dedup after filtering, return ordered arrays
4. **Update `VoicePoolBuilder.buildPool()`** class method — ensure it passes language correctly
5. **Verify** VoiceAllocator consumes ordered pool correctly (it iterates in order, so native voices get picked first — no changes needed)
