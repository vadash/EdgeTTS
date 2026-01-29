# Design: Voice Alias Matching on Import

## 1. Problem Statement

When importing a saved voice mapping JSON into a new book/chapter extraction, character names often differ slightly:
- "System" vs "The System"
- "Cale" vs "Cale Cadwell Cobbs"
- "Professor Rinkle" vs "Rinkle"

Current import uses exact canonical name matching (case-insensitive), causing voice assignments to be lost when names don't match exactly.

**Goal:** Auto-match imported character voices to extracted characters using alias lists and deterministic string matching rules.

## 2. Goals & Non-Goals

### Must do:
- Store character aliases (variations) in the voice mapping JSON
- Match on alias overlap when canonical names don't match
- Handle common structural differences: prefix stripping ("The X" ↔ "X"), containment ("Cale" in "Cale Cadwell Cobbs")
- Auto-apply voice silently (no confirmation dialogs)
- Log matches for debugging

### Won't do:
- Levenshtein/fuzzy distance matching (too risky for false positives)
- User-editable aliases separate from LLM variations (complexity vs value)
- Version bump (keep v1, aliases is optional)

## 3. Proposed Architecture

### High-level approach

1. **Export:** Include `aliases` array from `LLMCharacter.variations[]`
2. **Import:** Match using a cascade of rules, stop at first match
3. **Normalize:** Strip common prefixes, lowercase for comparison

### Key components

```
VoiceMappingService.ts
├── exportToJSON() / exportToJSONSorted()  -- add aliases field
├── importFromJSON()                        -- parse aliases (optional)
├── applyImportedMappings()                 -- new matching logic
├── normalizeForMatch()                     -- strip prefixes, lowercase
└── findBestMatch()                         -- cascade matcher
```

## 4. Data Models / Schema

### VoiceMappingEntry (updated)

```typescript
export interface VoiceMappingEntry {
  name: string;                              // Canonical name
  aliases?: string[];                        // All variations including name
  voice: string;                             // Voice ID
  gender: 'male' | 'female' | 'unknown';
}
```

### VoiceMappingFile (unchanged version)

```typescript
export interface VoiceMappingFile {
  version: 1;                                // Keep as 1
  narrator: string;
  voices: VoiceMappingEntry[];
}
```

### Example JSON output

```json
{
  "version": 1,
  "narrator": "en-US, AndrewMultilingualNeural",
  "voices": [
    {
      "name": "The System",
      "aliases": ["The System", "System"],
      "voice": "en-US, MichelleNeural",
      "gender": "female"
    },
    {
      "name": "Cale Cadwell Cobbs",
      "aliases": ["Cale Cadwell Cobbs", "Cale", "Cobbs"],
      "voice": "en-IE, ConnorNeural",
      "gender": "male"
    }
  ]
}
```

## 5. Interface / API Design

### Export functions (minor change)

```typescript
// Add aliases field from variations
export function exportToJSON(
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  narratorVoice: string
): string {
  const voices: VoiceMappingEntry[] = characters.map(char => ({
    name: char.canonicalName,
    aliases: char.variations,  // NEW: include all variations
    voice: voiceMap.get(char.canonicalName) ?? '',
    gender: char.gender,
  }));
  // ... rest unchanged
}

export function exportToJSONSorted(...) { /* same change */ }
```

### Import matching (new logic)

```typescript
/**
 * Normalize a name for matching:
 * 1. Lowercase
 * 2. Strip common prefixes: "The ", "A ", "An "
 * 3. Strip titles: "Professor ", "Lord ", "Lady ", "King ", "Queen ", etc.
 * 4. Trim whitespace
 */
export function normalizeForMatch(name: string): string;

/**
 * Match cascade for finding imported entry for a character:
 * 1. Exact canonical name match (case-insensitive)
 * 2. Current canonical in imported aliases
 * 3. Any current variation in imported aliases
 * 4. Any imported alias in current variations
 * 5. Normalized containment: normalized(A) contains normalized(B) or vice versa
 *
 * Returns first matching entry or undefined
 */
export function findMatchingEntry(
  char: LLMCharacter,
  importedEntries: VoiceMappingEntry[]
): VoiceMappingEntry | undefined;

/**
 * Apply imported entries with new matching logic
 */
export function applyImportedMappings(
  importedEntries: VoiceMappingEntry[],
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>
): Map<string, string>;
```

### Matching cascade detail

```
For each current character:
  1. EXACT: importMap[char.canonicalName.toLowerCase()]?
  2. ALIAS_HIT: any imported entry where char.canonicalName.toLowerCase() ∈ entry.aliases.map(toLowerCase)?
  3. VAR_IN_ALIAS: any imported entry where any char.variation.toLowerCase() ∈ entry.aliases.map(toLowerCase)?
  4. ALIAS_IN_VAR: any imported entry where any entry.alias.toLowerCase() ∈ char.variations.map(toLowerCase)?
  5. NORMALIZED: any imported entry where:
     - normalized(char.canonicalName) contains normalized(entry.name) OR
     - normalized(entry.name) contains normalized(char.canonicalName) OR
     - any normalized(char.variation) contains normalized(entry.alias) OR vice versa

  First match wins.
```

## 6. Risks & Edge Cases

### False positives (containment)

| Current | Imported | Risk |
|---------|----------|------|
| "John" | "John Smith" | Low — "John" in "John Smith" is valid |
| "Anna" | "Joanna" | **Medium** — "Anna" is substring but different person |

**Mitigation:** Containment only applies to normalized names with ≥4 chars, require word boundary match (split on spaces).

### Gender mismatch

Imported "Alex" (male) matches current "Alex" (female). Should we:
- (A) Apply anyway (current behavior)
- (B) Skip if gender conflicts

**Decision:** Apply anyway. User reviews in modal if needed.

### Multiple matches

Current "John" matches both imported "John Smith" and "John Doe".

**Decision:** First match wins (by order in imported array). Logging shows which matched.

### No aliases in old files

Old v1 files lack aliases field.

**Decision:** Fall back to current exact-match behavior when `aliases` is undefined.

## 7. Implementation Order

1. Update `VoiceMappingEntry` type to add optional `aliases` field
2. Add `normalizeForMatch()` function
3. Add `findMatchingEntry()` function
4. Update `applyImportedMappings()` to use new matching
5. Update `exportToJSON()` and `exportToJSONSorted()` to include `aliases`
6. Add debug logging for matches
7. Write unit tests for matching cascade

## 8. Test Cases

### Exact match (baseline)
```
Current: { canonicalName: "The System", variations: ["The System", "System"] }
Imported: { name: "The System", aliases: ["The System"] }
→ MATCH (exact canonical)
```

### Alias overlap
```
Current: { canonicalName: "System", variations: ["System"] }
Imported: { name: "The System", aliases: ["The System", "System"] }
→ MATCH (current canonical "System" in imported aliases)
```

### Containment
```
Current: { canonicalName: "Cale", variations: ["Cale"] }
Imported: { name: "Cale Cadwell Cobbs", aliases: ["Cale Cadwell Cobbs", "Cale"] }
→ MATCH (current variation "Cale" in imported aliases)
```

### Prefix stripping
```
Current: { canonicalName: "System", variations: ["System"] }
Imported: { name: "The System", aliases: ["The System"] }  // no "System" alias
→ MATCH (normalized "system" = normalized "the system")
```

### No match
```
Current: { canonicalName: "Marcus", variations: ["Marcus"] }
Imported: { name: "John", aliases: ["John", "Johnny"] }
→ NO MATCH
```

### Backward compatibility (no aliases)
```
Current: { canonicalName: "The System", variations: ["The System", "System"] }
Imported: { name: "The System" }  // old v1 file, no aliases
→ MATCH (exact canonical, aliases undefined handled gracefully)
```
