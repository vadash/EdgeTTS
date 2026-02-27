import { voices } from '../components/VoiceSelector/voices';
import type { VoicePool, VoiceOption } from '../state/types';
import type { DetectedLanguage } from '../utils/languageDetection';

/**
 * Build options for voice pool
 */
export interface VoicePoolOptions {
  /** Language/locale filter (e.g., 'en', 'ru') */
  language?: string;
  /** Include multilingual voices in addition to language match */
  includeMultilingual?: boolean;
  /** Only include voices in this allowlist */
  enabledVoices?: string[];
}

/**
 * Deduplicate Multilingual variant pairs and sort by priority.
 *
 * For pairs (e.g., AndrewNeural + AndrewMultilingualNeural in same locale):
 *   - If the voice's locale matches book language → keep non-Multilingual
 *   - Otherwise → keep Multilingual
 *
 * Returns voices sorted: non-Multilingual first, Multilingual last.
 */
export function deduplicateVariants(
  candidates: VoiceOption[],
  bookLanguage: string
): VoiceOption[] {
  const langPrefix = bookLanguage.split('-')[0];

  // Group by locale + baseName to find pairs
  // baseName: strip "Multilingual" → "AndrewMultilingualNeural" becomes "AndrewNeural"
  const groups = new Map<string, { native?: VoiceOption; multilingual?: VoiceOption }>();

  for (const voice of candidates) {
    const isMultilingual = voice.name.includes('Multilingual');
    const baseName = voice.name.replace('Multilingual', '');
    const key = `${voice.locale}|${baseName}`;

    if (!groups.has(key)) groups.set(key, {});
    const group = groups.get(key)!;

    if (isMultilingual) {
      group.multilingual = voice;
    } else {
      group.native = voice;
    }
  }

  // Resolve each group to a single voice
  const result: VoiceOption[] = [];
  for (const group of groups.values()) {
    if (group.native && group.multilingual) {
      // Pair exists — pick based on book language
      const isNativeLocale = group.native.locale.startsWith(langPrefix);
      result.push(isNativeLocale ? group.native : group.multilingual);
    } else {
      // No pair — keep whichever exists
      result.push((group.native ?? group.multilingual)!);
    }
  }

  // Sort: non-Multilingual first, Multilingual last
  result.sort((a, b) => {
    const aMulti = a.name.includes('Multilingual') ? 1 : 0;
    const bMulti = b.name.includes('Multilingual') ? 1 : 0;
    return aMulti - bMulti;
  });

  return result;
}

/**
 * Builds a voice pool filtered by language, separated by gender
 * - If language specified, filters by locale prefix
 * - If includeMultilingual=true, also includes voices with 'Multilingual' in name
 * - If enabledVoices provided, only includes those voices
 */
export function buildVoicePool(options: VoicePoolOptions = {}): VoicePool {
  const { language, includeMultilingual = false, enabledVoices } = options;

  // Start with enabled voices or all voices
  let baseVoices = enabledVoices && enabledVoices.length > 0
    ? voices.filter(v => enabledVoices.includes(v.fullValue))
    : voices;

  // Filter by language
  let filtered = language
    ? baseVoices.filter(v => {
        const matchesLang = v.locale.startsWith(language.split('-')[0]);
        const matchesMulti = includeMultilingual && v.name.includes('Multilingual');
        return matchesLang || matchesMulti;
      })
    : baseVoices;

  // Deduplicate Multilingual variant pairs when language is specified
  if (language) {
    filtered = deduplicateVariants(filtered, language);
  }

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}

/**
 * Get a random voice from the pool based on gender
 */
export function getRandomVoice(
  gender: 'male' | 'female' | 'unknown',
  options: VoicePoolOptions = {},
  excludeVoices: Set<string> = new Set()
): string {
  const pool = buildVoicePool(options);

  let candidates: string[];
  if (gender === 'male') {
    candidates = pool.male.filter(v => !excludeVoices.has(v));
  } else if (gender === 'female') {
    candidates = pool.female.filter(v => !excludeVoices.has(v));
  } else {
    candidates = [...pool.male, ...pool.female].filter(v => !excludeVoices.has(v));
  }

  // If all excluded, fall back to full pool
  if (candidates.length === 0) {
    candidates = gender === 'male' ? pool.male :
                 gender === 'female' ? pool.female :
                 [...pool.male, ...pool.female];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * VoicePoolBuilder class for DI
 * Delegates to buildVoicePool with includeMultilingual=true for LLM
 */
export class VoicePoolBuilder {
  buildPool(locale: string, enabledVoices?: string[]): VoicePool {
    return buildVoicePool({ language: locale, includeMultilingual: true, enabledVoices });
  }
}
