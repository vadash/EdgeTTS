// Data Store
// Manages application data (text content, book, dictionary, file handles)

import { signal } from '@preact/signals';
import type { ProcessedBook } from '@/state/types';
import {
  type DetectedLanguage,
  type DetectionResult,
  detectLanguage,
} from '@/utils/languageDetection';

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
  readonly dictionaryRaw = signal<string[]>([]); // Raw lines from .lexx files

  // File system
  readonly directoryHandle = signal<FileSystemDirectoryHandle | null>(null);

  // Language detection (explicit signal, not computed)
  readonly detectedLanguage = signal<DetectedLanguage>('en');

  // File naming state
  readonly loadedFileName = signal<string>('');

  // ========== Language Detection ==========

  /**
   * Explicitly detect language from current content
   * Call this when content is loaded or before conversion
   * @returns DetectionResult with language, confidence, and method
   */
  detectLanguageFromContent(): DetectionResult {
    const text = this.textContent.value;
    const bookText = this.book.value?.allSentences.join(' ') ?? '';
    const contentToAnalyze = text || bookText;
    const result = detectLanguage(contentToAnalyze);
    this.detectedLanguage.value = result.language;
    return result;
  }

  clearDetectedLanguage(): void {
    this.detectedLanguage.value = '';
  }

  setDetectedLanguage(lang: DetectedLanguage): void {
    this.detectedLanguage.value = lang;
  }

  setLoadedFileName(name: string): void {
    this.loadedFileName.value = name;
  }

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

  setDictionaryRaw(lines: string[]): void {
    this.dictionaryRaw.value = lines;
  }

  clearDictionary(): void {
    this.dictionaryRaw.value = [];
  }

  // ========== File System Actions ==========

  setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
    this.directoryHandle.value = handle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle.value = null;
  }

  // ========== Full Reset ==========

  /**
   * Clear all data
   */
  clear(): void {
    this.textContent.value = '';
    this.book.value = null;
    this.bookLoaded.value = false;
    this.dictionaryRaw.value = [];
    this.directoryHandle.value = null;
    this.loadedFileName.value = '';
  }
}

/**
 * Create a new DataStore instance
 */
export function createDataStore(): DataStore {
  return new DataStore();
}
