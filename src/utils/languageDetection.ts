/**
 * Simple language detection for English and Russian based on character scripts
 */

export type DetectedLanguage = 'en' | 'ru';

/**
 * Default max length to analyze for language detection (5KB)
 * Analyzing more text provides diminishing returns
 */
const DEFAULT_MAX_LENGTH = 5000;

/**
 * Detects if text is primarily English or Russian
 * @param text The text to analyze
 * @param maxLength Maximum characters to analyze (default 5000)
 * @returns 'en' for English, 'ru' for Russian
 */
export function detectLanguage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): DetectedLanguage {
  if (!text || text.trim().length === 0) {
    return 'en'; // Default to English for empty text
  }

  // Only analyze up to maxLength characters for performance
  const textToAnalyze = text.length > maxLength ? text.slice(0, maxLength) : text;

  let cyrillicCount = 0;
  let latinCount = 0;

  // Count Cyrillic and Latin characters
  for (const char of textToAnalyze) {
    const code = char.charCodeAt(0);

    // Cyrillic: U+0400–U+04FF
    if (code >= 0x0400 && code <= 0x04FF) {
      cyrillicCount++;
    }
    // Latin: A-Z, a-z
    else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
      latinCount++;
    }
  }

  // If more Cyrillic characters, it's Russian
  return cyrillicCount > latinCount ? 'ru' : 'en';
}
