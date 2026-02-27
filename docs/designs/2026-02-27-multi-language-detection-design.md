# Design: Multi-Language Book Detection

## 1. Problem Statement

Currently the app only detects Russian (Cyrillic) vs English (Latin) via simple character counting. Users load books in many languages — German, French, Spanish, Chinese, Arabic, etc. — but the app treats all non-Cyrillic text as English, leading to wrong voice filtering.

We need:
- Detect **any** of the 75 languages available in Edge TTS voices.
- Show the detected language as a **persistent badge** next to the filename in the file drop zone.
- Allow **manual override** if detection is wrong.
- **Fallback to EN** with a log message if detection fails.

## 2. Goals & Non-Goals

### Must do
- Expand `detectLanguage()` to support all Edge TTS voice locales (75 languages).
- Use Unicode script ranges + stopword lists for detection.
- Show 2-letter language code badge next to loaded book filename.
- Badge is persistent until a new book is loaded.
- On new book load: clear badge → load book → detect → show badge.
- Manual override via dropdown on the badge.
- Fallback to `'en'` with a log entry when detection is uncertain.
- Books are single-language (majority script/stopwords wins).

### Won't do
- Auto-switch voice/narrator settings (user does this manually).
- Add new UI language translations (this is about **content** language, not UI language).
- Support mixed-language books.
- Use external libraries for detection.

## 3. Proposed Architecture

### Layer 1: Script Detection

Map Unicode ranges to script families. Many scripts uniquely identify a language:

| Script | Unicode Range | Language(s) |
|--------|--------------|-------------|
| Hiragana/Katakana | U+3040–U+30FF | `ja` |
| Hangul | U+AC00–U+D7AF, U+1100–U+11FF | `ko` |
| CJK Unified | U+4E00–U+9FFF | `zh` (after excluding ja/ko) |
| Thai | U+0E00–U+0E7F | `th` |
| Georgian | U+10A0–U+10FF | `ka` |
| Armenian | U+0530–U+058F | `hy` |
| Greek | U+0370–U+03FF | `el` |
| Hebrew | U+0590–U+05FF | `he` |
| Devanagari | U+0900–U+097F | → stopwords (hi, mr, ne) |
| Arabic | U+0600–U+06FF | → stopwords (ar, fa, ur, ps) |
| Cyrillic | U+0400–U+04FF | → stopwords (ru, uk, bg, sr, mk, etc.) |
| Latin | U+0041–U+024F | → stopwords (en, de, fr, es, it, ...) |
| Bengali | U+0980–U+09FF | `bn` |
| Tamil | U+0B80–U+0BFF | `ta` |
| Telugu | U+0C00–U+0C7F | `te` |
| Kannada | U+0C80–U+0CFF | `kn` |
| Malayalam | U+0D00–U+0D7F | `ml` |
| Gujarati | U+0A80–U+0AFF | `gu` |
| Gurmukhi | U+0A00–U+0A7F | `pa` |
| Myanmar | U+1000–U+109F | `my` |
| Khmer | U+1780–U+17FF | `km` |
| Lao | U+0E80–U+0EFF | `lo` |
| Sinhala | U+0D80–U+0DFF | `si` |
| Ethiopic | U+1200–U+137F | `am` |
| Mongolian | U+1800–U+18AF | `mn` |

For unique-script languages, no stopwords needed — script alone is sufficient.

### Layer 2: Stopword Disambiguation (Latin, Cyrillic, Arabic, Devanagari)

For scripts shared by multiple languages, use **top-20 stopwords** per language. Process:

1. Tokenize the sample text (split on whitespace + punctuation).
2. Lowercase all tokens.
3. For each candidate language in the script family, count how many tokens match its stopword list.
4. Language with the highest stopword hit count wins.

**Stopword lists needed for Latin-script languages:**
- English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech, Slovak, Romanian, Hungarian, Swedish, Norwegian, Danish, Finnish, Estonian, Lithuanian, Latvian, Croatian, Bosnian, Slovenian, Albanian, Turkish, Azerbaijani, Indonesian, Malay, Vietnamese, Catalan, Galician, Welsh, Irish, Icelandic, Maltese, Swahili, Somali, Afrikaans, Zulu, Filipino, Javanese, Sundanese, Uzbek

**Stopword lists needed for Cyrillic-script languages:**
- Russian, Ukrainian, Bulgarian, Serbian, Macedonian, Kazakh, Mongolian

**Stopword lists needed for Arabic-script languages:**
- Arabic, Persian (Farsi), Urdu, Pashto

**Stopword lists needed for Devanagari-script languages:**
- Hindi, Marathi, Nepali

### Detection Flow

```
Input text (first 5000 chars)
  │
  ├─ Count characters per script
  ├─ Dominant script = highest count
  │
  ├─ If script maps to 1 language → return that language
  │
  ├─ If script maps to multiple languages (Latin/Cyrillic/Arabic/Devanagari):
  │   ├─ Tokenize text → lowercase words
  │   ├─ Match against stopword lists for all candidate languages
  │   ├─ Return language with highest stopword matches
  │   └─ If no stopwords match → fallback to default for script
  │       (Latin→en, Cyrillic→ru, Arabic→ar, Devanagari→hi)
  │
  └─ If no script detected (empty/symbols) → return 'en' + log
```

## 4. Data Models / Schema

### DetectedLanguage type change

```typescript
// BEFORE
export type DetectedLanguage = 'en' | 'ru';

// AFTER
export type DetectedLanguage = string; // ISO 639-1 two-letter code (e.g. 'en', 'ru', 'de', 'zh')
```

### Stopword data structure

```typescript
// In languageDetection.ts (or a separate languageData.ts if too large)

interface ScriptRange {
  start: number;
  end: number;
}

interface ScriptDefinition {
  name: string;
  ranges: ScriptRange[];
  /** If only one language uses this script, resolve directly */
  directLanguage?: string;
  /** If multiple languages share this script, use stopwords */
  candidateLanguages?: string[];
  /** Default fallback if stopwords don't resolve */
  fallbackLanguage?: string;
}

/** Top 20 stopwords per language, lowercase */
type StopwordMap = Record<string, string[]>;

// Example:
const STOPWORDS: StopwordMap = {
  en: ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'that', 'was', 'for', 'on', 'with', 'he', 'she', 'his', 'her', 'they', 'this', 'have'],
  de: ['der', 'die', 'und', 'den', 'das', 'ist', 'ein', 'eine', 'nicht', 'sich', 'mit', 'auf', 'des', 'dem', 'ich', 'auch', 'als', 'wie', 'von', 'aber'],
  fr: ['le', 'la', 'les', 'de', 'des', 'un', 'une', 'et', 'est', 'que', 'pas', 'pour', 'qui', 'dans', 'sur', 'avec', 'son', 'mais', 'nous', 'vous'],
  // ... etc for all candidate languages
};
```

### DataStore additions

```typescript
// New signal for the loaded book's display name
readonly loadedFileName = signal<string>('');

// DetectedLanguage type is now string
readonly detectedLanguage = signal<DetectedLanguage>('en');

// New: explicit clear before re-detection
clearDetectedLanguage(): void {
  this.detectedLanguage.value = '';
}

// New: manual override
setDetectedLanguage(lang: DetectedLanguage): void {
  this.detectedLanguage.value = lang;
}
```

## 5. Interface / API Design

### `detectLanguage()` — updated signature

```typescript
export interface DetectionResult {
  language: string;        // ISO 639-1 code
  confidence: 'high' | 'medium' | 'low';
  method: 'script' | 'stopwords' | 'fallback';
}

export function detectLanguage(
  text: string,
  maxLength?: number
): DetectionResult;
```

- `confidence: 'high'` — unique script match (e.g. Thai text → `th`)
- `confidence: 'medium'` — stopword match with clear winner
- `confidence: 'low'` — fallback (no stopwords matched, using script default)

The `confidence` and `method` fields are used only for logging. The `language` field is what gets stored in `DataStore.detectedLanguage`.

### FileDropZone UI — language badge

After book is loaded, show a badge next to the filename:

```
┌──────────────────────────────────────┐
│  📄 Drop files here or click         │
│     TXT, FB2, EPUB, ZIP              │
│                                      │
│  ✅ mybook.epub          [DE ▾]      │
└──────────────────────────────────────┘
```

- `[DE ▾]` is a small dropdown/select showing the 2-letter code uppercased.
- Clicking opens a list of all available languages (from voices.ts locales).
- Selecting a language manually overrides `DataStore.detectedLanguage`.
- Badge only visible when `bookLoaded === true`.
- Badge clears (disappears) when a new file starts loading, reappears after detection.

### Component structure

```tsx
// New small component, rendered inside FileDropZone
function LanguageBadge() {
  const dataStore = useData();
  const lang = dataStore.detectedLanguage.value;
  const bookLoaded = dataStore.bookLoaded.value;

  if (!bookLoaded || !lang) return null;

  return (
    <select
      value={lang}
      onChange={(e) => dataStore.setDetectedLanguage(e.currentTarget.value)}
      className="bg-primary border border-border rounded px-2 py-0.5 text-xs text-accent"
    >
      {AVAILABLE_LOCALES.map(code => (
        <option key={code} value={code}>{code.toUpperCase()}</option>
      ))}
    </select>
  );
}
```

### Book loading flow update

In `FileDropZone.handleFileChange` and `handleDrop`:

```typescript
// 1. Clear previous detection
dataStore.clearDetectedLanguage();

// 2. Load the book (existing logic)
// ...

// 3. Detect language
const result = dataStore.detectLanguageFromContent();

// 4. Store filename for display
dataStore.setLoadedFileName(file.name);

// 5. Log if fallback
if (result.confidence === 'low') {
  logs.warn(`Could not reliably detect book language, falling back to EN`);
}
```

### Voice filtering (QuickVoiceSelect)

No changes needed to the filtering logic — it already filters by `data.detectedLanguage.value` prefix. Since we're changing the type from `'en' | 'ru'` to any 2-letter code, it will automatically work with `de`, `fr`, `zh`, etc.

## 6. File Changes Summary

| File | Change |
|------|--------|
| `src/utils/languageDetection.ts` | Full rewrite: script detection + stopwords. New `DetectionResult` type. |
| `src/utils/languageDetection.test.ts` | Expand tests for new languages |
| `src/state/types.ts` | `DetectedLanguage` type → `string` |
| `src/stores/DataStore.ts` | Add `clearDetectedLanguage()`, `setDetectedLanguage()`, `loadedFileName` signal. Update `detectLanguageFromContent()` to use new detection API and return `DetectionResult`. |
| `src/stores/DataStore.test.ts` | Update tests |
| `src/components/convert/FileDropZone.tsx` | Add language badge, update load flow (clear → load → detect → show). |
| `src/hooks/useTTSConversion.ts` | No change needed (already reads `detectedLanguage` signal) |
| `src/components/convert/QuickVoiceSelect.tsx` | No change needed (already filters by locale prefix) |

## 7. Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| Stopword lists incomplete or wrong | Use well-known NLP stopword sets. 20 words per language is enough for book-length text. |
| Mixed-script text (e.g. English words in a German book) | Majority wins. Stopword approach handles this naturally. |
| Very short text (< 50 words) | Lower accuracy. Log `confidence: 'low'` if stopword counts are too close. |
| Language not in Edge TTS voices | Won't happen — we only detect languages that have voices available. Stopword lists only exist for languages with voices. |
| Empty text | Return `'en'` + log fallback. |
| `fil` (Filipino) is 3 letters | Map it to `fil` in detection but handle the 3-letter case in voice filtering (already works since `locale.startsWith('fil')` matches `fil-PH`). |
| Cyrillic ambiguity (RU vs UK vs BG) | Stopwords are highly distinctive: UK has "і", "та", "що"; BG has "на", "от", "за", "се"; RU has "что", "это", "как". |

## 8. Stopword Data Size Estimate

- ~45 Latin-script languages × 20 words × ~6 chars avg = ~5.4 KB
- ~7 Cyrillic languages × 20 words × ~8 chars avg = ~1.1 KB
- ~4 Arabic-script languages × 20 words × ~8 chars avg = ~0.6 KB
- ~3 Devanagari languages × 20 words × ~8 chars avg = ~0.5 KB
- **Total: ~8 KB** — negligible, can live inline in `languageDetection.ts`.
