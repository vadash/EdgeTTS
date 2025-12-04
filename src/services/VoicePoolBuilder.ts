import { voices } from '../components/VoiceSelector/voices';
import type { VoicePool } from '../state/types';
import type { DetectedLanguage } from '../utils/languageDetection';
import type { IVoicePoolBuilder } from './interfaces';

/**
 * VoicePoolBuilder class implementing IVoicePoolBuilder interface
 */
export class VoicePoolBuilder implements IVoicePoolBuilder {
  /**
   * Build voice pool filtered by locale and enabled voices
   */
  buildPool(locale: string, enabledVoices?: string[]): VoicePool {
    return buildFilteredPool(locale as DetectedLanguage, enabledVoices);
  }
}

/**
 * Builds a voice pool filtered by locale and separated by gender
 */
export function buildVoicePool(locale?: string, enabledVoices?: string[]): VoicePool {
  // Start with enabled voices or all voices
  let baseVoices = enabledVoices && enabledVoices.length > 0
    ? voices.filter(v => enabledVoices.includes(v.fullValue))
    : voices;

  // Filter by locale if specified
  const filtered = locale
    ? baseVoices.filter(v => v.locale.startsWith(locale.split('-')[0]))
    : baseVoices;

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}

/**
 * Builds a filtered voice pool for LLM voice assignment
 * Includes voices matching the detected language + multilingual voices
 * Respects user's enabled voices selection
 */
export function buildFilteredPool(language: DetectedLanguage = 'en', enabledVoices?: string[]): VoicePool {
  // Start with enabled voices or all voices
  const baseVoices = enabledVoices && enabledVoices.length > 0
    ? voices.filter(v => enabledVoices.includes(v.fullValue))
    : voices;

  // Filter by language + multilingual
  const filtered = baseVoices.filter(v =>
    v.locale.startsWith(language) ||
    v.name.includes('Multilingual')
  );

  return {
    male: filtered.filter(v => v.gender === 'male').map(v => v.fullValue),
    female: filtered.filter(v => v.gender === 'female').map(v => v.fullValue),
  };
}

/**
 * Get all voices from the filtered pool
 */
export function getFilteredVoices(language: DetectedLanguage = 'en'): string[] {
  const pool = buildFilteredPool(language);
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
