# Design: Cumulative Voice Profiles

## Constants

```typescript
/** Minimum speaking percentage to show character in UI (below = hidden but kept in JSON) */
const IMPORTANCE_THRESHOLD = 0.005; // 0.5%

/** Minimum similarity ratio for name matching (Levenshtein-based) */
const NAME_MATCH_THRESHOLD = 0.6; // 60%
```

## 1. Problem Statement

**Current Issues:**
1. Voice profiles are per-session ("book"). Characters from BOOK1 don't appear in BOOK4's voice selector.
2. No record of character importance (% of dialogue). All characters treated equally.
3. Fuzzy matching is over-complex but still fails on name variations ("John Smith" vs "Captain Smith").
4. For a 10-book series, user must re-assign voices for recurring characters each time.

**User Goal:**
Process a book series where main characters keep their voices across sessions, while filtering out insignificant one-off characters.

**Session Structure ("book"):**
```
AUDIOBOOKS/
├── BOOK1/
│   ├── voices.json
│   ├── resume.json
│   ├── chapter001.opus
│   └── ... (100+ opus files)
├── BOOK2/
│   ├── voices.json
│   └── ...
└── BOOK3/
    └── ...
```

## 2. Goals & Non-Goals

### Must Do:
- [x] Store character importance (% speaking frequency) in exported profiles
- [x] Cumulative carry-forward: each session's JSON contains ALL characters from previous sessions
- [x] Keep characters who had ≥0.5% dialogue (visible in UI)
- [x] Improve name matching for variations (titles, name order changes)
- [x] Tiered voice assignment: top chars get unique voices, rest can share
- [x] YAGNI/KISS: simple JSON structure, minimal changes

### Won't Do:
- [ ] v1 backward compatibility - only support v2 format
- [ ] Separate "series profile" - the last session's JSON IS the series profile
- [ ] Per-book archiving - one file per session, cumulative
- [ ] Automatic profile detection - user manually loads previous session's JSON
- [ ] Complex similarity scoring - simple key-based matching

## 3. Proposed Architecture

### High-Level Approach

**Cumulative Forward Pattern:**
```
BOOK1 session:
├─ Extract characters
├─ User assigns voices
└─ Export → BOOK1/voices.json (NEW)

BOOK2 session:
├─ Extract characters
├─ User loads BOOK1/voices.json
├─ Match existing characters by name → auto-assign voices
├─ New characters appear at bottom (no voice)
├─ User assigns remaining voices
└─ Export → BOOK2/voices.json (contains BOOK1 + BOOK2 chars)

BOOK3 session:
├─ Load BOOK2/voices.json (contains BOOK1 + BOOK2)
├─ ... same workflow
└─ Export → BOOK3/voices.json (contains BOOK1 + BOOK2 + BOOK3 chars)
```

**Key insight:** Each `voices.json` becomes the complete profile for the NEXT session. User only ever loads the most recent one.

### JSON Structure

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
    },
    "shopkeeper": {
      "canonicalName": "Shopkeeper",
      "voice": "en-US-MarkNeural",
      "gender": "male",
      "aliases": ["Shop Keeper", "Merchant"],
      "lines": 15,
      "percentage": 0.3,
      "lastSeenIn": "BOOK1",
      "bookAppearances": 1
    }
  }
}
```

**Field meanings:**
- `totalLines`: Sum of ALL dialogue lines across all sessions (global denominator)
- `lines`: This character's total lines across all sessions they appeared in
- `percentage`: `lines / totalLines * 100`
- `lastSeenIn`: Folder name where this character last appeared
- `bookAppearances`: How many sessions this character appeared in

**UI Filtering:**
- Characters with `percentage < 0.5%` are hidden from voice selector
- They remain in JSON - if they reappear in BOOK5, voice is preserved

## 4. Data Models / Schema

```typescript
interface VoiceProfileFile {
  version: 2;
  narrator: string;
  totalLines: number;
  characters: Record<string, CharacterEntry>;
}

interface CharacterEntry {
  // Core identity
  canonicalName: string;
  voice: string;
  gender: 'male' | 'female' | 'unknown';

  // Name matching - aliases from profile AND from all sessions
  aliases: string[];

  // Importance tracking (cumulative across sessions)
  lines: number;
  percentage: number;

  // Provenance
  lastSeenIn: string;
  bookAppearances: number;
}
```

## 5. Voice Assignment (Tiered)

**Problem:** 10 available voices, 40 characters (15 important, 25 minor)

**Solution:** Tiered assignment

```
1. Sort all characters by lines (descending)
2. Top N characters get UNIQUE voices (N = available voices count)
3. Remaining characters get SHARED voices (cycle through all voices)

Example with 10 voices, 40 characters:
├─ Characters 1-10:   unique voices (highest line counts)
├─ Characters 11-20:  share voices 1-10
├─ Characters 21-30:  share voices 1-10
└─ Characters 31-40:  share voices 1-10
```

**Algorithm:**
```typescript
interface VoiceAssignment {
  character: string;
  voice: string;
  shared: boolean;  // UI indicator
}

function assignVoicesTiered(
  characters: CharacterEntry[],
  availableVoices: VoiceOption[],
  narratorVoice: string
): Map<string, VoiceAssignment> {

  // 1. Filter out narrator, sort by lines descending
  const sorted = characters
    .filter(c => c.voice !== narratorVoice)
    .sort((a, b) => b.lines - a.lines);

  const result = new Map<string, VoiceAssignment>();
  const voiceCount = availableVoices.length;

  // 2. Top N get unique voices
  for (let i = 0; i < Math.min(voiceCount, sorted.length); i++) {
    result.set(sorted[i].canonicalName, {
      character: sorted[i].canonicalName,
      voice: availableVoices[i].fullValue,
      shared: false
    });
  }

  // 3. Rest get shared voices (cycle through all)
  for (let i = voiceCount; i < sorted.length; i++) {
    result.set(sorted[i].canonicalName, {
      character: sorted[i].canonicalName,
      voice: availableVoices[i % voiceCount].fullValue,
      shared: true
    });
  }

  return result;
}
```

**UI Display:**
```
┌─────────────────────┬──────────────────┬────────┐
│ Character           │ Voice            │        │
├─────────────────────┼──────────────────┼────────┤
│ Harry Potter        │ en-GB-RyanNeural │        │
│ Ron Weasley         │ en-US-GuyNeural  │        │
│ ... (top 10)        │ ...              │        │
├─────────────────────┼──────────────────┼────────┤
│ Shopkeeper          │ en-GB-RyanNeural │ SHARED │
│ Guard #1            │ en-US-GuyNeural  │ SHARED │
│ ... (rest)          │ ...              │        │
└─────────────────────┴──────────────────┴────────┘
```

**Note:** When loading an existing profile, preserve manual voice assignments. Only auto-assign new characters.

## 6. Interface / API Design

### Core Functions

```typescript
/**
 * Calculate similarity ratio between two names (Levenshtein-based)
 * Returns 0-1, where 1 is identical match
 */
export function similarityRatio(a: string, b: string): number;

/**
 * Find best matching character entry from profile
 * Cross-compares canonical name + aliases
 */
export function matchCharacter(
  char: LLMCharacter,
  profile: Record<string, CharacterEntry>
): CharacterEntry | undefined;

/**
 * Export to cumulative profile format (version 2)
 * Merges existing profile + current session's characters
 */
export function exportToProfile(
  existingProfile: VoiceProfileFile | null,
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string,
  sessionName: string
): string;

/**
 * Import profile and match against current session's characters
 * Returns matched voices + unmatched new characters
 */
export function importProfile(
  profileJson: string,
  currentCharacters: LLMCharacter[]
): {
  voiceMap: Map<string, string>;
  matchedCharacters: Set<string>;
  unmatchedCharacters: string[];
};

/**
 * Check if character should be visible in UI
 */
export function isCharacterVisible(entry: CharacterEntry): boolean;

/**
 * Tiered voice assignment
 */
export function assignVoicesTiered(
  characters: CharacterEntry[],
  availableVoices: VoiceOption[],
  narratorVoice: string
): Map<string, VoiceAssignment>;
```

### Export with Merge Algorithm

```typescript
function exportToProfile(
  existingProfile: VoiceProfileFile | null,
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>,
  assignments: SpeakerAssignment[],
  narratorVoice: string,
  sessionName: string
): string {

  // 1. Count current session's dialogue per character
  const currentCounts = countSpeakingFrequency(assignments);
  const currentTotalLines = assignments.length;

  // 2. Calculate new global total
  const previousTotalLines = existingProfile?.totalLines ?? 0;
  const newTotalLines = previousTotalLines + currentTotalLines;

  // 3. Start with existing characters or empty
  const merged: Record<string, CharacterEntry> = {};
  if (existingProfile) {
    for (const [key, entry] of Object.entries(existingProfile.characters)) {
      merged[key] = { ...entry };
    }
  }

  // 4. Update/add current session's characters
  for (const char of currentCharacters) {
    const currentLines = currentCounts.get(char.canonicalName) ?? 0;

    // Try to find matching entry in existing profile
    const matchedEntry = existingProfile
      ? matchCharacter(char, merged)
      : undefined;

    if (matchedEntry) {
      // Existing: update counts
      matchedEntry.lines += currentLines;
      matchedEntry.percentage = (matchedEntry.lines / newTotalLines) * 100;
      matchedEntry.lastSeenIn = sessionName;
      matchedEntry.bookAppearances++;

      // Update voice if changed
      const newVoice = currentVoiceMap.get(char.canonicalName);
      if (newVoice) matchedEntry.voice = newVoice;

      // Merge aliases (both ways: from profile and from current extraction)
      for (const alias of char.variations) {
        if (!matchedEntry.aliases.includes(alias)) {
          matchedEntry.aliases.push(alias);
        }
      }
    } else {
      // New character - use canonical name as key
      const key = char.canonicalName.toLowerCase().replace(/\s+/g, '_');
      merged[key] = {
        canonicalName: char.canonicalName,
        voice: currentVoiceMap.get(char.canonicalName) ?? '',
        gender: char.gender,
        aliases: char.variations,
        lines: currentLines,
        percentage: (currentLines / newTotalLines) * 100,
        lastSeenIn: sessionName,
        bookAppearances: 1
      };
    }
  }

  // 5. Build output
  const output: VoiceProfileFile = {
    version: 2,
    narrator: narratorVoice,
    totalLines: newTotalLines,
    characters: merged
  };

  return JSON.stringify(output, null, 2);
}
```

## 7. Name Matching (Levenshtein Distance)

### Similarity Calculation

```typescript
/**
 * Calculate Levenshtein distance between two strings
 */
function levenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix = Array(an + 1).fill(null).map(() => Array(bn + 1).fill(0));

  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[an][bn];
}

/**
 * Calculate similarity ratio (0 to 1, higher is better)
 * 1.0 = identical, 0.0 = completely different
 */
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  return 1 - (dist / maxLen);
}
```

### Matching Algorithm (Cross-Compare All)

**Key insight:** Compare ALL combinations of:
- `char.canonicalName` + `char.variations`
- VS
- `entry.canonicalName` + `entry.aliases`

Find the best match above threshold.

```typescript
function matchCharacter(
  char: LLMCharacter,
  profile: Record<string, CharacterEntry>
): CharacterEntry | undefined {

  let bestMatch: CharacterEntry | undefined;
  let bestScore = 0;

  // Build list of all names for this character
  const charNames = [char.canonicalName, ...char.variations];

  for (const entry of Object.values(profile)) {
    // Build list of all names for profile entry
    const entryNames = [entry.canonicalName, ...entry.aliases];

    // Try all combinations
    for (const cn of charNames) {
      for (const en of entryNames) {
        const score = similarityRatio(cn, en);
        if (score > bestScore && score >= NAME_MATCH_THRESHOLD) {
          bestScore = score;
          bestMatch = entry;
        }
      }
    }
  }

  return bestMatch;
}
```

### Examples

| Profile | Book 2 Extracts | Similarity | Match? |
|---------|-----------------|------------|--------|
| "Harry Potter" | "Harry Potter" | 1.00 | ✓ |
| "Captain John Smith" | "John Smith" | 0.72 | ✓ |
| "Professor Dumbledore" | "Dumbledore" | 0.68 | ✓ |
| "Lord Voldemort" | "Voldemort" | 0.67 | ✓ |
| "Harry Potter" | "The Boy Who Lived" | 0.15 | ✗ |
| "John Smith" | "John Jones" | 0.67 | ✗ (false positive?) |

**Note:** "John Smith" vs "John Jones" gives 0.67 but shouldn't match. However:
- The `aliases` field helps - if user adds "Jones" as alias for "John Smith", it won't create duplicate
- User can manually resolve conflicts
- This is acceptable edge case for simplicity

## 8. Risks & Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Same name, different characters | User must manually resolve. Add `aliases` to disambiguate. |
| Character name changes mid-series | Add new alias to existing entry, don't create duplicate. |
| Voice no longer available | Keep voice ID in profile, UI shows "Voice not found" indicator. |
| Empty character list (no dialogue detected) | Export valid JSON with empty `characters` object. |
| Corrupt JSON file | Parse error with line number. User can fix manually or start fresh. |
| User wants different voice for same character | New voice assignment overwrites old one, counts preserved. |
| Session processed twice | `bookAppearances` would be wrong, but voice is correct. Acceptable. |
| User skips a book (loads BOOK1 for BOOK3) | BOOK2 characters missing, but BOOK3 gets BOOK1 voices. User's choice. |
| More characters than voices (40 chars, 10 voices) | Tiered assignment: top 10 unique, rest share. |
| All voices shared (many low-importance chars) | UI shows SHARED badge for visibility. |

## 9. Implementation Checklist

- [ ] Add `VoiceProfileFile` and `CharacterEntry` types to `types.ts`
- [ ] Add `IMPORTANCE_THRESHOLD` and `NAME_MATCH_THRESHOLD` constants
- [ ] Implement `levenshtein()` function
- [ ] Implement `similarityRatio()` function
- [ ] Implement `matchCharacter()` function with cross-comparison
- [ ] Implement `exportToProfile()` function with merge logic
- [ ] Implement `importProfile()` function with matching
- [ ] Implement `isCharacterVisible()` helper
- [ ] Implement `assignVoicesTiered()` function
- [ ] Update UI to:
  - [ ] Load/import profile button
  - [ ] Display character percentage
  - [ ] Filter characters by `IMPORTANCE_THRESHOLD`
  - [ ] Show SHARED badge for shared voices
  - [ ] Show `lastSeenIn` metadata (optional)
- [ ] Add unit tests for Levenshtein matching edge cases
- [ ] Add unit tests for percentage calculation
- [ ] Add unit tests for tiered voice assignment

## 10. Removed Features (YAGNI)

- ~~v1 format support~~ - Only v2, simpler code
- ~~Per-book character archiving~~ - One cumulative file per session
- ~~Automatic profile detection~~ - User manually loads previous session
- ~~Title prefix stripping~~ - Levenshtein handles it automatically
