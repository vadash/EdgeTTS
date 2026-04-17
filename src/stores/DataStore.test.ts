import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessedBook } from '@/state/types';
import { createDataStore, type DataStore } from './DataStore';

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = createDataStore();
  });

  describe('book management', () => {
    const mockBook: ProcessedBook = {
      allSentences: ['Sentence 1.', 'Sentence 2.'],
      fileNames: [
        ['chapter1', 0],
        ['chapter2', 1],
      ],
      fullText: 'test content',
    };

    it('clears book', () => {
      store.setBook(mockBook);
      store.clearBook();
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
    });
  });

  describe('computed properties', () => {
    describe('hasContent', () => {
      it('returns false when empty', () => {
        expect(store.hasContent.value).toBe(false);
      });

      it('returns true when has text content', () => {
        store.setTextContent('Some text');
        expect(store.hasContent.value).toBe(true);
      });

      it('returns true when has book', () => {
        store.setBook({ allSentences: ['Test'], fileNames: [], fullText: 'Test' });
        expect(store.hasContent.value).toBe(true);
      });
    });

    describe('sentenceCount', () => {
      it('returns 0 when no book', () => {
        expect(store.sentenceCount.value).toBe(0);
      });

      it('returns sentence count from book', () => {
        store.setBook({ allSentences: ['A.', 'B.', 'C.'], fileNames: [], fullText: 'A. B. C.' });
        expect(store.sentenceCount.value).toBe(3);
      });
    });

    describe('fileNames', () => {
      it('returns empty array when no book', () => {
        expect(store.fileNames.value).toEqual([]);
      });

      it('returns file names from book', () => {
        const fileNames: [string, number][] = [
          ['ch1', 0],
          ['ch2', 5],
        ];
        store.setBook({ allSentences: ['A.'], fileNames, fullText: 'A.' });
        expect(store.fileNames.value).toEqual(fileNames);
      });
    });

    describe('hasDictionary', () => {
      it('returns false when empty', () => {
        expect(store.hasDictionary.value).toBe(false);
      });

      it('returns true when has parsed rules', () => {
        store.setDictionary([{ type: 'word', pattern: 'a', replacement: 'b' }]);
        expect(store.hasDictionary.value).toBe(true);
      });

      it('returns true when has raw lines', () => {
        store.setDictionaryRaw(['a=b']);
        expect(store.hasDictionary.value).toBe(true);
      });
    });

    describe('hasDirectoryHandle', () => {
      it('returns false when no handle', () => {
        expect(store.hasDirectoryHandle.value).toBe(false);
      });

      it('returns true when has handle', () => {
        store.setDirectoryHandle({} as FileSystemDirectoryHandle);
        expect(store.hasDirectoryHandle.value).toBe(true);
      });
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

      it('clears loaded file name on clear()', () => {
        store.setLoadedFileName('mybook.epub');
        store.clear();
        expect(store.loadedFileName.value).toBe('');
      });
    });
  });

  describe('clear', () => {
    it('clears all data', () => {
      store.setTextContent('text');
      store.setBook({ allSentences: ['A.'], fileNames: [], fullText: 'A.' });
      store.setDictionary([{ type: 'word', pattern: 'a', replacement: 'b' }]);
      store.setDictionaryRaw(['a=b']);
      store.setDirectoryHandle({} as FileSystemDirectoryHandle);

      store.clear();

      expect(store.textContent.value).toBe('');
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
      expect(store.dictionary.value).toEqual([]);
      expect(store.dictionaryRaw.value).toEqual([]);
      expect(store.directoryHandle.value).toBeNull();
    });
  });

  describe('resetForConversion', () => {
    it('keeps directory handle', () => {
      const mockHandle = {} as FileSystemDirectoryHandle;
      store.setDirectoryHandle(mockHandle);

      store.resetForConversion();

      expect(store.directoryHandle.value).toBe(mockHandle);
    });
  });
});
