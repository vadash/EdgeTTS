/**
 * Multi-language detection using Unicode script analysis
 */

export type DetectedLanguage = string;

export interface DetectionResult {
  language: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'script' | 'stopwords' | 'fallback';
}

/**
 * Default max length to analyze for language detection (5KB)
 * Analyzing more text provides diminishing returns
 */
const DEFAULT_MAX_LENGTH = 5000;

interface ScriptRange {
  start: number;
  end: number;
}

interface ScriptDef {
  name: string;
  ranges: ScriptRange[];
  directLanguage?: string;        // unique script → language
  candidateLanguages?: string[];   // shared script → needs stopwords
  fallbackLanguage?: string;       // default if stopwords fail
}

const SCRIPTS: ScriptDef[] = [
  { name: 'hiragana_katakana', ranges: [{ start: 0x3040, end: 0x30FF }, { start: 0x31F0, end: 0x31FF }], directLanguage: 'ja' },
  { name: 'hangul', ranges: [{ start: 0xAC00, end: 0xD7AF }, { start: 0x1100, end: 0x11FF }], directLanguage: 'ko' },
  { name: 'thai', ranges: [{ start: 0x0E00, end: 0x0E7F }], directLanguage: 'th' },
  { name: 'georgian', ranges: [{ start: 0x10A0, end: 0x10FF }], directLanguage: 'ka' },
  { name: 'greek', ranges: [{ start: 0x0370, end: 0x03FF }], directLanguage: 'el' },
  { name: 'hebrew', ranges: [{ start: 0x0590, end: 0x05FF }], directLanguage: 'he' },
  { name: 'bengali', ranges: [{ start: 0x0980, end: 0x09FF }], directLanguage: 'bn' },
  { name: 'tamil', ranges: [{ start: 0x0B80, end: 0x0BFF }], directLanguage: 'ta' },
  { name: 'telugu', ranges: [{ start: 0x0C00, end: 0x0C7F }], directLanguage: 'te' },
  { name: 'kannada', ranges: [{ start: 0x0C80, end: 0x0CFF }], directLanguage: 'kn' },
  { name: 'malayalam', ranges: [{ start: 0x0D00, end: 0x0D7F }], directLanguage: 'ml' },
  { name: 'gujarati', ranges: [{ start: 0x0A80, end: 0x0AFF }], directLanguage: 'gu' },
  { name: 'myanmar', ranges: [{ start: 0x1000, end: 0x109F }], directLanguage: 'my' },
  { name: 'khmer', ranges: [{ start: 0x1780, end: 0x17FF }], directLanguage: 'km' },
  { name: 'lao', ranges: [{ start: 0x0E80, end: 0x0EFF }], directLanguage: 'lo' },
  { name: 'sinhala', ranges: [{ start: 0x0D80, end: 0x0DFF }], directLanguage: 'si' },
  { name: 'ethiopic', ranges: [{ start: 0x1200, end: 0x137F }], directLanguage: 'am' },
  { name: 'cjk', ranges: [{ start: 0x4E00, end: 0x9FFF }], directLanguage: 'zh' },
  { name: 'devanagari', ranges: [{ start: 0x0900, end: 0x097F }], candidateLanguages: ['hi', 'mr', 'ne'], fallbackLanguage: 'hi' },
  { name: 'arabic', ranges: [{ start: 0x0600, end: 0x06FF }], candidateLanguages: ['ar', 'fa', 'ur', 'ps'], fallbackLanguage: 'ar' },
  { name: 'cyrillic', ranges: [{ start: 0x0400, end: 0x04FF }], candidateLanguages: ['ru', 'uk', 'bg', 'sr', 'mk', 'kk'], fallbackLanguage: 'ru' },
  { name: 'latin', ranges: [{ start: 0x0041, end: 0x005A }, { start: 0x0061, end: 0x007A }, { start: 0x00C0, end: 0x024F }], candidateLanguages: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'ro', 'hu', 'sv', 'nb', 'da', 'fi', 'et', 'lt', 'lv', 'hr', 'bs', 'sl', 'sq', 'tr', 'az', 'id', 'ms', 'vi', 'ca', 'gl', 'cy', 'ga', 'is', 'mt', 'sw', 'so', 'af', 'zu', 'fil', 'jv', 'su', 'uz'], fallbackLanguage: 'en' },
];

function classifyChar(code: number): string | null {
  for (const script of SCRIPTS) {
    for (const range of script.ranges) {
      if (code >= range.start && code <= range.end) return script.name;
    }
  }
  return null;
}

function detectDominantScript(text: string): ScriptDef | null {
  const counts: Record<string, number> = {};
  for (const char of text) {
    const script = classifyChar(char.charCodeAt(0));
    if (script) counts[script] = (counts[script] || 0) + 1;
  }
  // Special case: if both CJK and hiragana/katakana present, it's Japanese
  if (counts['hiragana_katakana'] && counts['cjk']) {
    return SCRIPTS.find(s => s.name === 'hiragana_katakana')!;
  }
  let maxScript: string | null = null;
  let maxCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > maxCount) { maxCount = count; maxScript = name; }
  }
  return maxScript ? SCRIPTS.find(s => s.name === maxScript) ?? null : null;
}

/**
 * Detects language from text using Unicode script analysis
 * @param text The text to analyze
 * @param maxLength Maximum characters to analyze (default 5000)
 * @returns DetectionResult with language code, confidence, and method
 */
export function detectLanguage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): DetectionResult {
  if (!text || text.trim().length === 0) {
    return { language: 'en', confidence: 'low', method: 'fallback' };
  }
  const sample = text.length > maxLength ? text.slice(0, maxLength) : text;
  const script = detectDominantScript(sample);
  if (!script) {
    return { language: 'en', confidence: 'low', method: 'fallback' };
  }
  if (script.directLanguage) {
    return { language: script.directLanguage, confidence: 'high', method: 'script' };
  }
  // TODO: stopword disambiguation — Task 3
  // Temporary: use fallback
  return { language: script.fallbackLanguage ?? 'en', confidence: 'low', method: 'fallback' };
}
