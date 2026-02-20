import { voices } from '../components/VoiceSelector/voices';
import type { VoicePool } from '../state/types';
import type { DetectedLanguage } from '../utils/languageDetection';
import type { IVoicePoolBuilder } from './interfaces';

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
  const filtered = language
    ? baseVoices.filter(v => {
        const matchesLang = v.locale.startsWith(language.split('-')[0]);
        const matchesMulti = includeMultilingual && v.name.includes('Multilingual');
        return matchesLang || matchesMulti;
      })
    : baseVoices;

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
 * VoicePoolBuilder class implementing IVoicePoolBuilder interface for DI
 * Delegates to buildVoicePool with includeMultilingual=true for LLM
 */
export class VoicePoolBuilder implements IVoicePoolBuilder {
  buildPool(locale: string, enabledVoices?: string[]): VoicePool {
    return buildVoicePool({ language: locale, includeMultilingual: true, enabledVoices });
  }
}
