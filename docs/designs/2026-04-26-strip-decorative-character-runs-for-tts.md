# Strip Decorative Character Runs for TTS

**Date:** 2026-04-26
**Status:** Approved
**Related Issue:** TTS reads decorative separators character-by-character

## Problem

Decorative character runs like `_____________________`, `¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯`, `*****`, `~~~~`, etc. appear in books (especially litRPG/web novels with game-system UI elements). TTS reads them character-by-character ("underscore underscore underscore...").

These patterns serve as visual separators and have no audio value. They need to be stripped **globally** — not just at start-of-line or only in long sentences.

## Sample from Book

```
             "Get me out!"
             While the Germinal Organization was small fry...
             Suddenly, a glowing line of blue text blue appeared before his eyes.

             ___________________

             You have been injected with Valkyrie!
             +1 Endurance
             ¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯
```

## Approach

Extend `sanitizeText()` in `ConversionOrchestrator.ts` with a new rule that replaces **inline** decorative character runs (3+ consecutive repeated decorative characters) with a period/pause. This handles all variants:

- `___` / `______` (underscores)
- `¯¯¯` / `¯¯¯¯¯¯` (macrons/overlines)
- `***` / `******` (asterisks)
- `~~~` / `~~~~~~` (tildes)
- `===` / `======` (equals)
- `---` / `------` (dashes)
- `•••` / `•••••` (bullets)
- `···` / `·····` (middle dots)
- `─` / `═══` (box drawing chars)

## Implementation Changes

### 1. `src/services/ConversionOrchestrator.ts` — `sanitizeText()`

- Add a new step (between current step 1 and 2) that replaces inline runs of 3+ decorative characters with `...` (pause marker)
- Pattern: `/[¯_~*=\-•·─═]{3,}/g` → `...`
- This replaces the existing step 1 (`^[-*_]{3,}$`) which only handled full-line separators — the new pattern handles both inline and full-line cases

### 2. `src/services/TextBlockSplitter.ts` — `splitLongSentences()`

- The existing `SEPARATOR_RE = /[¯_]{5,}/g` in `splitLongSentences` still works for splitting — no change needed there since it operates on raw text before sanitization

### 3. Tests

- Add test cases to existing test file for the new decorative pattern stripping
- Cover: underscores, macrons, mixed inline (e.g. `"text _____ more text"`), standalone separator lines, litRPG stat block patterns from the sample
