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

  let cyrillicCount = 0;
  let latinCount = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code >= 0x0400 && code <= 0x04FF) cyrillicCount++;
    else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) latinCount++;
  }

  const lang = cyrillicCount > latinCount ? 'ru' : 'en';
  return { language: lang, confidence: 'medium', method: 'script' };
}
