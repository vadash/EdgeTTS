// Language Store
// Manages application language/locale settings

import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';

/**
 * Supported locales
 */
export type SupportedLocale = 'en' | 'ru';

/**
 * Language Store - manages i18n locale
 */
export class LanguageStore {
  readonly locale = signal<SupportedLocale>('en');

  // ========== Computed Properties ==========

  /**
   * Check if current locale is English
   */
  readonly isEnglish = computed(() => this.locale.value === 'en');

  /**
   * Check if current locale is Russian
   */
  readonly isRussian = computed(() => this.locale.value === 'ru');

  // ========== Actions ==========

  /**
   * Set locale
   */
  setLocale(locale: SupportedLocale): void {
    this.locale.value = locale;
    this.save();
  }

  /**
   * Toggle between en and ru
   */
  toggle(): void {
    this.locale.value = this.locale.value === 'en' ? 'ru' : 'en';
    this.save();
  }

  // ========== Persistence ==========

  /**
   * Save to localStorage
   */
  save(): void {
    localStorage.setItem(StorageKeys.language, this.locale.value);
  }

  /**
   * Load from localStorage
   */
  load(): void {
    const saved = localStorage.getItem(StorageKeys.language);
    if (saved === 'en' || saved === 'ru') {
      this.locale.value = saved;
    } else {
      // Try to detect from browser
      const browserLang = navigator.language.split('-')[0];
      this.locale.value = browserLang === 'ru' ? 'ru' : 'en';
    }
  }

  /**
   * Reset to default (English)
   */
  reset(): void {
    this.locale.value = 'en';
    this.save();
  }
}

/**
 * Create a new LanguageStore instance
 */
export function createLanguageStore(): LanguageStore {
  return new LanguageStore();
}
