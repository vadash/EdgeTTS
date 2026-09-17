import { computed, signal } from '@preact/signals';
import { StorageKeys } from '@/config/storage';

export type SupportedLocale = 'en' | 'ru';

export class LanguageStore {
  readonly locale = signal<SupportedLocale>('en');

  readonly isEnglish = computed(() => this.locale.value === 'en');

  readonly isRussian = computed(() => this.locale.value === 'ru');

  setLocale(locale: SupportedLocale): void {
    this.locale.value = locale;
    this.save();
  }

  toggle(): void {
    this.locale.value = this.locale.value === 'en' ? 'ru' : 'en';
    this.save();
  }

  save(): void {
    localStorage.setItem(StorageKeys.language, this.locale.value);
  }

  load(): void {
    const saved = localStorage.getItem(StorageKeys.language);
    if (saved === 'en' || saved === 'ru') {
      this.locale.value = saved;
    } else {
      const browserLang = navigator.language.split('-')[0];
      this.locale.value = browserLang === 'ru' ? 'ru' : 'en';
    }
  }

  reset(): void {
    this.locale.value = 'en';
    this.save();
  }
}

export function createLanguageStore(): LanguageStore {
  return new LanguageStore();
}
