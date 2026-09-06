import { beforeEach, describe, expect, it } from 'vitest';
import { createDataStore, type DataStore } from './DataStore';

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = createDataStore();
  });

  describe('detectedLanguage', () => {
    it('defaults to English', () => {
      expect(store.detectedLanguage.value).toBe('en');
    });

    it.each([
      ['This is English text with many words.', 'en'],
      ['Это русский текст с множеством слов.', 'ru'],
    ])('detects language from text content: "%s"', (text, expectedLang) => {
      store.setTextContent(text);
      store.detectLanguageFromContent();
      expect(store.detectedLanguage.value).toBe(expectedLang);
    });

    it('detects from book when no text content', () => {
      store.setBook({
        allSentences: ['Русский текст.'],
        fileNames: [],
        fullText: 'Русский текст.',
      });
      store.detectLanguageFromContent();
      expect(store.detectedLanguage.value).toBe('ru');
    });

    it('returns DetectionResult from method', () => {
      store.setTextContent('Это русский текст.');
      const result = store.detectLanguageFromContent();
      expect(result.language).toBe('ru');
      expect(result.confidence).toBeDefined();
      expect(result.method).toBeDefined();
    });

    it('clears detected language', () => {
      store.setTextContent('Это русский текст с множеством слов.');
      store.detectLanguageFromContent();
      expect(store.detectedLanguage.value).toBe('ru');
      store.clearDetectedLanguage();
      expect(store.detectedLanguage.value).toBe('');
    });

    it('allows manual language override', () => {
      store.setTextContent('This is English text.');
      store.detectLanguageFromContent();
      expect(store.detectedLanguage.value).toBe('en');
      store.setDetectedLanguage('de');
      expect(store.detectedLanguage.value).toBe('de');
    });
  });

  describe('clear', () => {
    it('clears all data', () => {
      store.setTextContent('text');
      store.setBook({ allSentences: ['A.'], fileNames: [], fullText: 'A.' });
      store.setDictionaryRaw(['a=b']);
      store.setDirectoryHandle({} as FileSystemDirectoryHandle);

      store.clear();

      expect(store.textContent.value).toBe('');
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
      expect(store.dictionaryRaw.value).toEqual([]);
      expect(store.directoryHandle.value).toBeNull();
    });
  });
});
