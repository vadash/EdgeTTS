import { voices } from '../components/VoiceSelector/voices';
import type { VoiceOption, VoicePool } from '../state/types';

export interface VoicePoolOptions {
  /** Language/locale filter (e.g., 'en', 'ru') */
  language?: string;
  /** Include multilingual voices in addition to language match */
  includeMultilingual?: boolean;
  enabledVoices?: string[];
}

/**
 * Deduplicate Multilingual variant pairs and sort by priority: native
 * voices first, Multilingual voices last.
 *
 * For a pair (e.g., AndrewNeural and AndrewMultilingualNeural in one
 * locale), the native voice wins when its locale matches the book
 * language; otherwise keep the Multilingual voice.
 */
export function deduplicateVariants(
  candidates: VoiceOption[],
  bookLanguage: string,
): VoiceOption[] {
  const langPrefix = bookLanguage.split('-')[0];

  // Group by locale and base name to find pairs; the base name strips
  // "Multilingual", so "AndrewMultilingualNeural" pairs with "AndrewNeural".
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

  const result: VoiceOption[] = [];
  for (const group of groups.values()) {
    if (group.native && group.multilingual) {
      const isNativeLocale = group.native.locale.startsWith(langPrefix);
      result.push(isNativeLocale ? group.native : group.multilingual);
    } else {
      result.push((group.native ?? group.multilingual)!);
    }
  }

  result.sort((a, b) => {
    const aMulti = a.name.includes('Multilingual') ? 1 : 0;
    const bMulti = b.name.includes('Multilingual') ? 1 : 0;
    return aMulti - bMulti;
  });

  return result;
}

export function buildVoicePool(options: VoicePoolOptions = {}): VoicePool {
  const { language, includeMultilingual = false, enabledVoices } = options;

  const baseVoices = enabledVoices
    ? voices.filter((v) => enabledVoices.includes(v.fullValue))
    : voices;

  let filtered = language
    ? baseVoices.filter((v) => {
        const matchesLang = v.locale.startsWith(language.split('-')[0]);
        const matchesMulti = includeMultilingual && v.name.includes('Multilingual');
        return matchesLang || matchesMulti;
      })
    : baseVoices;

  if (language) {
    filtered = deduplicateVariants(filtered, language);
  }

  return {
    male: filtered.filter((v) => v.gender === 'male').map((v) => v.fullValue),
    female: filtered.filter((v) => v.gender === 'female').map((v) => v.fullValue),
  };
}

export function getRandomVoice(
  gender: 'male' | 'female' | 'unknown',
  options: VoicePoolOptions = {},
  excludeVoices: Set<string> = new Set(),
): string {
  const pool = buildVoicePool(options);

  let candidates: string[];
  if (gender === 'male') {
    candidates = pool.male.filter((v) => !excludeVoices.has(v));
  } else if (gender === 'female') {
    candidates = pool.female.filter((v) => !excludeVoices.has(v));
  } else {
    candidates = [...pool.male, ...pool.female].filter((v) => !excludeVoices.has(v));
  }

  // Every candidate is excluded, so fall back to the full pool.
  if (candidates.length === 0) {
    candidates =
      gender === 'male'
        ? pool.male
        : gender === 'female'
          ? pool.female
          : [...pool.male, ...pool.female];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Injectable wrapper around buildVoicePool so callers receive it through
 * DI. Fixes includeMultilingual=true so the LLM passes also see
 * Multilingual voices.
 */
export class VoicePoolBuilder {
  buildPool(locale: string, enabledVoices?: string[]): VoicePool {
    return buildVoicePool({ language: locale, includeMultilingual: true, enabledVoices });
  }
}
