import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@/config/storage';
import { createLanguageStore, type LanguageStore } from './LanguageStore';

describe('LanguageStore', () => {
  let store: LanguageStore;

  beforeEach(() => {
    localStorage.clear();
    store = createLanguageStore();
  });

  describe('initial state', () => {
    it('starts with English locale', () => {
      expect(store.locale.value).toBe('en');
    });

    it('isEnglish is true by default', () => {
      expect(store.isEnglish.value).toBe(true);
    });

    it('isRussian is false by default', () => {
      expect(store.isRussian.value).toBe(false);
    });
  });

  describe('setLocale', () => {
    it('sets locale to Russian', () => {
      store.setLocale('ru');
      expect(store.locale.value).toBe('ru');
      expect(store.isRussian.value).toBe(true);
      expect(store.isEnglish.value).toBe(false);
    });

    it('sets locale to English', () => {
      store.setLocale('ru');
      store.setLocale('en');
      expect(store.locale.value).toBe('en');
      expect(store.isEnglish.value).toBe(true);
      expect(store.isRussian.value).toBe(false);
    });

    it('persists to localStorage', () => {
      store.setLocale('ru');
      expect(localStorage.getItem(StorageKeys.language)).toBe('ru');
    });
  });

  describe('toggle', () => {
    it('toggles from English to Russian', () => {
      store.toggle();
      expect(store.locale.value).toBe('ru');
    });

    it('toggles from Russian to English', () => {
      store.setLocale('ru');
      store.toggle();
      expect(store.locale.value).toBe('en');
    });

    it('persists toggle to localStorage', () => {
      store.toggle();
      expect(localStorage.getItem(StorageKeys.language)).toBe('ru');
    });
  });

  describe('persistence', () => {
    it('saves to localStorage', () => {
      store.setLocale('ru');
      store.save();
      expect(localStorage.getItem(StorageKeys.language)).toBe('ru');
    });

    it('loads English from localStorage', () => {
      localStorage.setItem(StorageKeys.language, 'en');
      store.load();
      expect(store.locale.value).toBe('en');
    });

    it('loads Russian from localStorage', () => {
      localStorage.setItem(StorageKeys.language, 'ru');
      store.load();
      expect(store.locale.value).toBe('ru');
    });

    it('defaults to English for invalid localStorage value', () => {
      localStorage.setItem(StorageKeys.language, 'invalid');
      // Mock navigator.language to English
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      store.load();
      expect(store.locale.value).toBe('en');
      vi.restoreAllMocks();
    });

    it('detects Russian from browser language', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
      store.load();
      expect(store.locale.value).toBe('ru');
      vi.restoreAllMocks();
    });

    it('defaults to English for other browser languages', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
      store.load();
      expect(store.locale.value).toBe('en');
      vi.restoreAllMocks();
    });
  });

  describe('reset', () => {
    it('resets to English', () => {
      store.setLocale('ru');
      store.reset();
      expect(store.locale.value).toBe('en');
    });

    it('persists reset to localStorage', () => {
      store.setLocale('ru');
      store.reset();
      expect(localStorage.getItem(StorageKeys.language)).toBe('en');
    });
  });
});
