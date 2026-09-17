import { signal } from '@preact/signals';
import type { ProcessedBook } from '@/state/types';
import {
  type DetectedLanguage,
  type DetectionResult,
  detectLanguage,
} from '@/utils/languageDetection';

export class DataStore {
  readonly textContent = signal<string>('');

  readonly book = signal<ProcessedBook | null>(null);
  readonly bookLoaded = signal<boolean>(false);

  readonly dictionaryRaw = signal<string[]>([]); // Raw lines from .lexx files

  readonly directoryHandle = signal<FileSystemDirectoryHandle | null>(null);

  // Explicit signal, not computed: detection runs on demand.
  readonly detectedLanguage = signal<DetectedLanguage>('en');

  readonly loadedFileName = signal<string>('');

  /**
   * Detects language on demand; call after content loads and before conversion.
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

  setTextContent(text: string): void {
    this.textContent.value = text;
  }

  clearTextContent(): void {
    this.textContent.value = '';
  }

  setBook(book: ProcessedBook | null): void {
    this.book.value = book;
    this.bookLoaded.value = book !== null;
  }

  clearBook(): void {
    this.book.value = null;
    this.bookLoaded.value = false;
  }

  setDictionaryRaw(lines: string[]): void {
    this.dictionaryRaw.value = lines;
  }

  clearDictionary(): void {
    this.dictionaryRaw.value = [];
  }

  setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
    this.directoryHandle.value = handle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle.value = null;
  }

  clear(): void {
    this.textContent.value = '';
    this.book.value = null;
    this.bookLoaded.value = false;
    this.dictionaryRaw.value = [];
    this.directoryHandle.value = null;
    this.loadedFileName.value = '';
  }
}

export function createDataStore(): DataStore {
  return new DataStore();
}
