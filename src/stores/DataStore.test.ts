import { beforeEach, describe, expect, it } from 'vitest';
import type { DictionaryRule, ProcessedBook, TTSWorker } from '@/state/types';
import { createDataStore, type DataStore } from './DataStore';

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = createDataStore();
  });

  describe('initial state', () => {
    it('starts with empty text content', () => {
      expect(store.textContent.value).toBe('');
    });

    it('starts with no book', () => {
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
    });

    it('starts with empty dictionary', () => {
      expect(store.dictionary.value).toEqual([]);
      expect(store.dictionaryRaw.value).toEqual([]);
    });

    it('starts with no directory handle', () => {
      expect(store.directoryHandle.value).toBeNull();
    });

    it('starts with no active workers', () => {
      expect(store.activeWorkers.value).toEqual([]);
    });

    it('starts with default file naming state', () => {
      expect(store.fileNameIndex.value).toBe(1);
      expect(store.numBook.value).toBe(0);
      expect(store.numText.value).toBe(0);
    });
  });

  describe('text content management', () => {
    it('clears text content', () => {
      store.setTextContent('Some text');
      store.clearTextContent();
      expect(store.textContent.value).toBe('');
    });
  });

  describe('book management', () => {
    const mockBook: ProcessedBook = {
      allSentences: ['Sentence 1.', 'Sentence 2.'],
      fileNames: [
        ['chapter1', 0],
        ['chapter2', 1],
      ],
    };

    it('sets book', () => {
      store.setBook(mockBook);
      expect(store.book.value).toEqual(mockBook);
      expect(store.bookLoaded.value).toBe(true);
    });

    it('clears book', () => {
      store.setBook(mockBook);
      store.clearBook();
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
    });

    it('sets book to null', () => {
      store.setBook(mockBook);
      store.setBook(null);
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
    });
  });

  describe('dictionary management', () => {
    const mockRules: DictionaryRule[] = [
      { type: 'word', pattern: 'test', replacement: 'тест' },
      { type: 'exact', pattern: 'hello', replacement: 'привет' },
    ];

    it('clears dictionary', () => {
      store.setDictionary(mockRules);
      store.setDictionaryRaw(['test=тест']);
      store.clearDictionary();
      expect(store.dictionary.value).toEqual([]);
      expect(store.dictionaryRaw.value).toEqual([]);
    });
  });

  describe('directory handle management', () => {
    it('clears directory handle', () => {
      const mockHandle = {} as FileSystemDirectoryHandle;
      store.setDirectoryHandle(mockHandle);
      store.clearDirectoryHandle();
      expect(store.directoryHandle.value).toBeNull();
    });
  });

  describe('workers management', () => {
    const mockWorker: TTSWorker = {
      id: 1,
      status: 'working',
      partIndex: 0,
      filename: 'test.mp3',
    };

    it('adds worker', () => {
      store.addWorker(mockWorker);
      expect(store.activeWorkers.value).toContainEqual(mockWorker);
    });

    it('updates worker', () => {
      store.addWorker(mockWorker);
      store.updateWorker(1, { status: 'complete' });
      expect(store.activeWorkers.value[0].status).toBe('complete');
    });

    it('removes worker', () => {
      store.addWorker(mockWorker);
      store.removeWorker(1);
      expect(store.activeWorkers.value).toEqual([]);
    });

    it('clears workers', () => {
      store.addWorker(mockWorker);
      store.clearWorkers();
      expect(store.activeWorkers.value).toEqual([]);
    });

    it('does not update non-existent worker', () => {
      store.addWorker(mockWorker);
      store.updateWorker(999, { status: 'complete' });
      expect(store.activeWorkers.value[0].status).toBe('working');
    });
  });

  describe('file naming state', () => {
    it('increments file name index', () => {
      store.setFileNameIndex(5);
      const current = store.incrementFileNameIndex();
      expect(current).toBe(5);
      expect(store.fileNameIndex.value).toBe(6);
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
        store.setBook({ allSentences: ['Test'], fileNames: [] });
        expect(store.hasContent.value).toBe(true);
      });
    });

    describe('sentenceCount', () => {
      it('returns 0 when no book', () => {
        expect(store.sentenceCount.value).toBe(0);
      });

      it('returns sentence count from book', () => {
        store.setBook({ allSentences: ['A.', 'B.', 'C.'], fileNames: [] });
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
        store.setBook({ allSentences: ['A.'], fileNames });
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

      it('detects English from text content', () => {
        store.setTextContent('This is English text with many words.');
        store.detectLanguageFromContent();
        expect(store.detectedLanguage.value).toBe('en');
      });

      it('detects Russian from text content', () => {
        store.setTextContent('Это русский текст с множеством слов.');
        store.detectLanguageFromContent();
        expect(store.detectedLanguage.value).toBe('ru');
      });

      it('detects from book when no text content', () => {
        store.setBook({ allSentences: ['Русский текст.'], fileNames: [] });
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

      it('stores loaded file name', () => {
        expect(store.loadedFileName.value).toBe('');
        store.setLoadedFileName('mybook.epub');
        expect(store.loadedFileName.value).toBe('mybook.epub');
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
      store.setBook({ allSentences: ['A.'], fileNames: [] });
      store.setDictionary([{ type: 'word', pattern: 'a', replacement: 'b' }]);
      store.setDictionaryRaw(['a=b']);
      store.setDirectoryHandle({} as FileSystemDirectoryHandle);
      store.addWorker({ id: 1, status: 'working', partIndex: 0, filename: 'test' });
      store.setFileNameIndex(5);
      store.setNumBook(3);
      store.setNumText(7);

      store.clear();

      expect(store.textContent.value).toBe('');
      expect(store.book.value).toBeNull();
      expect(store.bookLoaded.value).toBe(false);
      expect(store.dictionary.value).toEqual([]);
      expect(store.dictionaryRaw.value).toEqual([]);
      expect(store.directoryHandle.value).toBeNull();
      expect(store.activeWorkers.value).toEqual([]);
      expect(store.fileNameIndex.value).toBe(1);
      expect(store.numBook.value).toBe(0);
      expect(store.numText.value).toBe(0);
    });
  });

  describe('resetForConversion', () => {
    it('resets conversion-specific state but keeps directory handle', () => {
      const mockHandle = {} as FileSystemDirectoryHandle;
      store.setDirectoryHandle(mockHandle);
      store.addWorker({ id: 1, status: 'working', partIndex: 0, filename: 'test' });
      store.setFileNameIndex(5);

      store.resetForConversion();

      expect(store.activeWorkers.value).toEqual([]);
      expect(store.fileNameIndex.value).toBe(1);
      expect(store.directoryHandle.value).toBe(mockHandle);
    });
  });
});
