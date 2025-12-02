import { voices } from '../components/VoiceSelector/voices';
import type { VoicePool } from '../state/types';

/**
 * Builds a voice pool filtered by locale and separated by gender
 */
export function buildVoicePool(locale?: string): VoicePool {
  const filtered = locale
    ? voices.filter(v => v.locale.startsWith(locale.split('-')[0]))
    : voices;

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}

/**
 * Builds a filtered voice pool for LLM voice assignment
 * Includes only: ru-*, en-*, and voices with "Multilingual" in name
 */
export function buildFilteredPool(): VoicePool {
  const filtered = voices.filter(v =>
    v.locale.startsWith('ru') ||
    v.locale.startsWith('en') ||
    v.name.includes('Multilingual')
  );

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}

/**
 * Get all voices from the filtered pool (ru-*, en-*, multilingual)
 */
export function getFilteredVoices(): string[] {
  const pool = buildFilteredPool();
  return [...pool.male, ...pool.female];
}

/**
 * Get all male voices, optionally filtered by locale
 */
export function getMaleVoices(locale?: string): string[] {
  return buildVoicePool(locale).male;
}

/**
 * Get all female voices, optionally filtered by locale
 */
export function getFemaleVoices(locale?: string): string[] {
  return buildVoicePool(locale).female;
}

/**
 * Get a random voice from the pool based on gender
 */
export function getRandomVoice(
  gender: 'male' | 'female' | 'unknown',
  locale?: string,
  excludeVoices: Set<string> = new Set()
): string {
  const pool = buildVoicePool(locale);

  let candidates: string[];
  if (gender === 'male') {
    candidates = pool.male.filter(v => !excludeVoices.has(v));
  } else if (gender === 'female') {
    candidates = pool.female.filter(v => !excludeVoices.has(v));
  } else {
    // For unknown gender, pick from both pools
    candidates = [...pool.male, ...pool.female].filter(v => !excludeVoices.has(v));
  }

  // If all voices are excluded, fall back to the full pool
  if (candidates.length === 0) {
    candidates = gender === 'male' ? pool.male :
                 gender === 'female' ? pool.female :
                 [...pool.male, ...pool.female];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}
