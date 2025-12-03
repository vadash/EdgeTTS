// Data Store
// Manages application data (text content, book, dictionary, file handles)

import { signal, computed } from '@preact/signals';
import type { ProcessedBook, DictionaryRule, TTSWorker } from '@/state/types';
import { detectLanguage, type DetectedLanguage } from '@/utils/languageDetection';

/**
 * Data Store - manages application data
 */
export class DataStore {
  // Text content
  readonly textContent = signal<string>('');

  // Book data
  readonly book = signal<ProcessedBook | null>(null);
  readonly bookLoaded = signal<boolean>(false);

  // Dictionary
  readonly dictionary = signal<DictionaryRule[]>([]);
  readonly dictionaryRaw = signal<string[]>([]); // Raw lines for backward compatibility

  // File system
  readonly directoryHandle = signal<FileSystemDirectoryHandle | null>(null);

  // Workers state (for tracking active TTS workers)
  readonly activeWorkers = signal<TTSWorker[]>([]);

  // File naming state
  readonly fileNameIndex = signal<number>(1);
  readonly numBook = signal<number>(0);
  readonly numText = signal<number>(0);

  // ========== Computed Properties ==========

  /**
   * Check if there's content to convert
   */
  readonly hasContent = computed(() =>
    this.textContent.value.length > 0 || this.book.value !== null
  );

  /**
   * Get total sentence count
   */
  readonly sentenceCount = computed(() =>
    this.book.value?.allSentences.length ?? 0
  );

  /**
   * Get file names from book
   */
  readonly fileNames = computed(() =>
    this.book.value?.fileNames ?? []
  );

  /**
   * Check if dictionary has rules
   */
  readonly hasDictionary = computed(() =>
    this.dictionary.value.length > 0 || this.dictionaryRaw.value.length > 0
  );

  /**
   * Check if directory handle is available
   */
  readonly hasDirectoryHandle = computed(() =>
    this.directoryHandle.value !== null
  );

  /**
   * Detect language from text content
   */
  readonly detectedLanguage = computed<DetectedLanguage>(() => {
    const text = this.textContent.value;
    const bookText = this.book.value?.allSentences.join(' ') ?? '';
    const contentToAnalyze = text || bookText;
    return detectLanguage(contentToAnalyze);
  });

  // ========== Text Content Actions ==========

  setTextContent(text: string): void {
    this.textContent.value = text;
  }

  clearTextContent(): void {
    this.textContent.value = '';
  }

  // ========== Book Actions ==========

  setBook(book: ProcessedBook | null): void {
    this.book.value = book;
    this.bookLoaded.value = book !== null;
  }

  clearBook(): void {
    this.book.value = null;
    this.bookLoaded.value = false;
  }

  // ========== Dictionary Actions ==========

  setDictionary(rules: DictionaryRule[]): void {
    this.dictionary.value = rules;
  }

  setDictionaryRaw(lines: string[]): void {
    this.dictionaryRaw.value = lines;
  }

  clearDictionary(): void {
    this.dictionary.value = [];
    this.dictionaryRaw.value = [];
  }

  // ========== File System Actions ==========

  setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
    this.directoryHandle.value = handle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle.value = null;
  }

  // ========== Workers Actions ==========

  setActiveWorkers(workers: TTSWorker[]): void {
    this.activeWorkers.value = workers;
  }

  addWorker(worker: TTSWorker): void {
    this.activeWorkers.value = [...this.activeWorkers.value, worker];
  }

  updateWorker(id: number, updates: Partial<TTSWorker>): void {
    const workers = this.activeWorkers.value.map(w =>
      w.id === id ? { ...w, ...updates } : w
    );
    this.activeWorkers.value = workers;
  }

  removeWorker(id: number): void {
    this.activeWorkers.value = this.activeWorkers.value.filter(w => w.id !== id);
  }

  clearWorkers(): void {
    this.activeWorkers.value = [];
  }

  // ========== File Naming Actions ==========

  setFileNameIndex(index: number): void {
    this.fileNameIndex.value = index;
  }

  incrementFileNameIndex(): number {
    const current = this.fileNameIndex.value;
    this.fileNameIndex.value = current + 1;
    return current;
  }

  setNumBook(num: number): void {
    this.numBook.value = num;
  }

  setNumText(num: number): void {
    this.numText.value = num;
  }

  // ========== Full Reset ==========

  /**
   * Clear all data
   */
  clear(): void {
    this.textContent.value = '';
    this.book.value = null;
    this.bookLoaded.value = false;
    this.dictionary.value = [];
    this.dictionaryRaw.value = [];
    this.directoryHandle.value = null;
    this.activeWorkers.value = [];
    this.fileNameIndex.value = 1;
    this.numBook.value = 0;
    this.numText.value = 0;
  }

  /**
   * Reset for new conversion (keep directory handle)
   */
  resetForConversion(): void {
    this.activeWorkers.value = [];
    this.fileNameIndex.value = 1;
  }
}

/**
 * Create a new DataStore instance
 */
export function createDataStore(): DataStore {
  return new DataStore();
}
