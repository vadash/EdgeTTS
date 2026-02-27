/**
 * Multi-language detection using Unicode script analysis and stopword disambiguation
 */

import { STOPWORDS } from './stopwords';

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
  directLanguage?: string; // unique script → language
  candidateLanguages?: string[]; // shared script → needs stopwords
  fallbackLanguage?: string; // default if stopwords fail
}

const SCRIPTS: ScriptDef[] = [
  {
    name: 'hiragana_katakana',
    ranges: [
      { start: 0x3040, end: 0x30ff },
      { start: 0x31f0, end: 0x31ff },
    ],
    directLanguage: 'ja',
  },
  {
    name: 'hangul',
    ranges: [
      { start: 0xac00, end: 0xd7af },
      { start: 0x1100, end: 0x11ff },
    ],
    directLanguage: 'ko',
  },
  { name: 'thai', ranges: [{ start: 0x0e00, end: 0x0e7f }], directLanguage: 'th' },
  { name: 'georgian', ranges: [{ start: 0x10a0, end: 0x10ff }], directLanguage: 'ka' },
  { name: 'greek', ranges: [{ start: 0x0370, end: 0x03ff }], directLanguage: 'el' },
  { name: 'hebrew', ranges: [{ start: 0x0590, end: 0x05ff }], directLanguage: 'he' },
  { name: 'bengali', ranges: [{ start: 0x0980, end: 0x09ff }], directLanguage: 'bn' },
  { name: 'tamil', ranges: [{ start: 0x0b80, end: 0x0bff }], directLanguage: 'ta' },
  { name: 'telugu', ranges: [{ start: 0x0c00, end: 0x0c7f }], directLanguage: 'te' },
  { name: 'kannada', ranges: [{ start: 0x0c80, end: 0x0cff }], directLanguage: 'kn' },
  { name: 'malayalam', ranges: [{ start: 0x0d00, end: 0x0d7f }], directLanguage: 'ml' },
  { name: 'gujarati', ranges: [{ start: 0x0a80, end: 0x0aff }], directLanguage: 'gu' },
  { name: 'myanmar', ranges: [{ start: 0x1000, end: 0x109f }], directLanguage: 'my' },
  { name: 'khmer', ranges: [{ start: 0x1780, end: 0x17ff }], directLanguage: 'km' },
  { name: 'lao', ranges: [{ start: 0x0e80, end: 0x0eff }], directLanguage: 'lo' },
  { name: 'sinhala', ranges: [{ start: 0x0d80, end: 0x0dff }], directLanguage: 'si' },
  { name: 'ethiopic', ranges: [{ start: 0x1200, end: 0x137f }], directLanguage: 'am' },
  { name: 'cjk', ranges: [{ start: 0x4e00, end: 0x9fff }], directLanguage: 'zh' },
  {
    name: 'devanagari',
    ranges: [{ start: 0x0900, end: 0x097f }],
    candidateLanguages: ['hi', 'mr', 'ne'],
    fallbackLanguage: 'hi',
  },
  {
    name: 'arabic',
    ranges: [{ start: 0x0600, end: 0x06ff }],
    candidateLanguages: ['ar', 'fa', 'ur', 'ps'],
    fallbackLanguage: 'ar',
  },
  {
    name: 'cyrillic',
    ranges: [{ start: 0x0400, end: 0x04ff }],
    candidateLanguages: ['ru', 'uk', 'bg', 'sr', 'mk', 'kk'],
    fallbackLanguage: 'ru',
  },
  {
    name: 'latin',
    ranges: [
      { start: 0x0041, end: 0x005a },
      { start: 0x0061, end: 0x007a },
      { start: 0x00c0, end: 0x024f },
    ],
    candidateLanguages: [
      'en',
      'de',
      'fr',
      'es',
      'it',
      'pt',
      'nl',
      'pl',
      'cs',
      'sk',
      'ro',
      'hu',
      'sv',
      'nb',
      'da',
      'fi',
      'et',
      'lt',
      'lv',
      'hr',
      'bs',
      'sl',
      'sq',
      'tr',
      'az',
      'id',
      'ms',
      'vi',
      'ca',
      'gl',
      'cy',
      'ga',
      'is',
      'mt',
      'sw',
      'so',
      'af',
      'zu',
      'fil',
      'jv',
      'su',
      'uz',
    ],
    fallbackLanguage: 'en',
  },
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
  if (counts.hiragana_katakana && counts.cjk) {
    return SCRIPTS.find((s) => s.name === 'hiragana_katakana')!;
  }
  let maxScript: string | null = null;
  let maxCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxScript = name;
    }
  }
  return maxScript ? (SCRIPTS.find((s) => s.name === maxScript) ?? null) : null;
}

function disambiguateByStopwords(
  text: string,
  candidateLanguages: string[],
  fallbackLanguage: string,
): DetectionResult {
  // Tokenize: split on non-letter characters, lowercase
  // Supports Latin, Cyrillic, Arabic, and Devanagari scripts
  const words = text
    .toLowerCase()
    .split(/[^a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F]+/)
    .filter((w) => w.length > 0);

  let bestLang = fallbackLanguage;
  let bestCount = 0;

  for (const lang of candidateLanguages) {
    const stopwords = STOPWORDS[lang];
    if (!stopwords) continue;
    let count = 0;
    for (const word of words) {
      if (stopwords.has(word)) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang;
    }
  }

  if (bestCount === 0) {
    return { language: fallbackLanguage, confidence: 'low', method: 'fallback' };
  }
  return { language: bestLang, confidence: 'medium', method: 'stopwords' };
}

/**
 * Detects language from text using Unicode script analysis and stopword disambiguation
 * @param text The text to analyze
 * @param maxLength Maximum characters to analyze (default 5000)
 * @returns DetectionResult with language code, confidence, and method
 */
export function detectLanguage(
  text: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): DetectionResult {
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
  // Use stopword disambiguation for shared scripts
  if (script.candidateLanguages && script.fallbackLanguage) {
    return disambiguateByStopwords(sample, script.candidateLanguages, script.fallbackLanguage);
  }
  // Fallback if no candidates defined
  return { language: script.fallbackLanguage ?? 'en', confidence: 'low', method: 'fallback' };
}
