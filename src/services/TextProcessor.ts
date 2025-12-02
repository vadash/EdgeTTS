// TextProcessor Service - Text chunking and dictionary processing
// Migrated from processing_file.js

import { TEXT_PROCESSING } from '../utils/constants';
import type { ProcessedBook } from '../state/types';

export interface TextProcessorOptions {
  fileName: string;
  text: string;
  dictionary: string[];
  caseSensitive: boolean;
  pointsSelect: string;
  pointsType: 'V1' | 'V2' | 'V3';
  firstStringsLength?: number;
  lastStringsLength?: number;
}

export class TextProcessor {
  private fileNames: Array<[string, number]>;
  private firstStringsLength: number;
  private lastStringsLength: number;
  private dictionary: string[];
  private caseSensitive: boolean;
  private pointsSelect: string;
  private pointsType: 'V1' | 'V2' | 'V3';

  fullText: string;
  allSentences: string[];

  constructor(options: TextProcessorOptions) {
    this.fileNames = [[options.fileName, 0]];
    this.firstStringsLength = options.firstStringsLength ?? TEXT_PROCESSING.FIRST_STRINGS_LENGTH;
    this.lastStringsLength = options.lastStringsLength ?? TEXT_PROCESSING.LAST_STRINGS_LENGTH;
    this.dictionary = options.dictionary;
    this.caseSensitive = options.caseSensitive;
    this.pointsSelect = options.pointsSelect;
    this.pointsType = options.pointsType;
    this.fullText = options.text;

    const preSentences = this.applyDictionary(this.fullText);
    this.allSentences = this.splitIntoSections(preSentences);
  }

  private applyDictionary(text: string): string[] {
    // Sanitize text
    let fixText = text.replace(/[~|*^]/g, '-');
    fixText = fixText.replace(/\\/g, '/');
    fixText = fixText.replace(/&/g, ' and ');
    fixText = fixText.replace(/</g, '(');
    fixText = fixText.replace(/>/g, ')');

    // Apply dictionary rules
    if (this.dictionary.length > 0) {
      for (const rule of this.dictionary) {
        const regexMatch = rule.match(/^regex"(.*)"="(.*)"/);
        if (regexMatch) {
          // Regex rule
          const regex = new RegExp(regexMatch[1], 'g');
          const replacement = regexMatch[2].replace(/\\r/g, '\r').replace(/\\n/g, '\n');
          fixText = fixText.replace(regex, replacement);
        } else if (rule.length > 0) {
          // Non-regex rule
          if (rule[0] === '"') {
            const matchArr = rule.trim().replaceAll('"', '').split('=');
            if (matchArr.length === 2) {
              if (this.caseSensitive) {
                fixText = fixText.replaceAll(matchArr[0], matchArr[1]);
              } else {
                const regex = new RegExp(this.escapeRegex(matchArr[0]), 'giu');
                fixText = fixText.replace(regex, matchArr[1]);
              }
            }
          } else {
            const matchArr = rule.trim().split('=');
            if (matchArr.length === 2) {
              if (this.caseSensitive) {
                const regex = new RegExp(`(^|\\s)${matchArr[0]}(?=\\s|$)`, 'gi');
                fixText = fixText.replace(regex, `$1${matchArr[1]}`);
              } else {
                const escaped = this.escapeRegex(matchArr[0]);
                if (this.isPunctuation(matchArr[0])) {
                  const regex = new RegExp(escaped, 'giu');
                  fixText = fixText.replace(regex, matchArr[1]);
                } else {
                  const regex = new RegExp(`(^|\\s|\\p{P})${escaped}(?=\\p{P}|\\s|$)`, 'giu');
                  fixText = fixText.replace(regex, `$1${matchArr[1]}`);
                }
              }
            }
          }
        }
      }
    }

    // Apply points replacement
    if (this.pointsSelect !== 'Не заменять точки') {
      if (this.pointsSelect === 'Заменять на три строки') {
        fixText = fixText.replace(/\./g, '\r\n\r\n\r\n\r\n');
      } else {
        const newPoint = this.pointsSelect[this.pointsSelect.length - 1];
        if (this.pointsType === 'V1') {
          fixText = fixText.replace(/\./g, newPoint);
        } else if (this.pointsType === 'V2') {
          fixText = fixText.replace(/\.[ \t]{1,}\n/g, '.\n');
          fixText = fixText.replace(/\.(?![\r\n])/g, newPoint);
        } else if (this.pointsType === 'V3') {
          fixText = fixText.replace(/\.[ \t]{1,}\n/g, '.\n');
          fixText = fixText.replace(/\.[ \t]/g, `${newPoint} `);
        }
      }
    }

    return fixText.split('\n').filter(Boolean);
  }

  private splitIntoSections(sentences: string[]): string[] {
    const result: string[] = [];
    const splitter = ' ';
    let currentText = '';

    for (let i = 0; i < sentences.length; i++) {
      // Check for paragraph breaks (3+ consecutive empty lines)
      if (
        i > 2 &&
        sentences[i].trim() !== '' &&
        sentences[i - 1].trim() === '' &&
        sentences[i - 2].trim() === '' &&
        sentences[i - 3].trim() === '' &&
        this.containsPronounceableChars(currentText)
      ) {
        currentText += '\n';
        if (currentText.length > 0) {
          result.push(currentText);
          currentText = '';
        }
      }

      const line = sentences[i];
      const words = line.split(splitter);

      for (const word of words) {
        if (
          currentText.length + word.length > this.lastStringsLength &&
          ['.', ',', '!', '?', ':', ';', '-'].includes(word[word.length - 1])
        ) {
          result.push(currentText + splitter + word);
          currentText = '';
        } else {
          if (currentText.length > 0) {
            currentText += splitter;
          }
          currentText += word;
        }
      }

      if (currentText.length > 0) {
        currentText += '\n';
      }
    }

    if (currentText.length > 0) {
      result.push(currentText);
    }

    return result;
  }

  addNewText(fileName: string, text: string): void {
    this.fileNames[this.fileNames.length - 1][1] = this.allSentences.length;
    this.fileNames.push([fileName, 0]);

    const preSentences = this.applyDictionary(text);
    const newSentences = this.splitIntoSections(preSentences);
    this.allSentences = [...this.allSentences, ...newSentences];
  }

  clear(): void {
    this.fileNames = [['Book', 0]];
    this.fullText = '';
    this.allSentences = [];
  }

  getProcessedBook(): ProcessedBook {
    return {
      fileNames: this.fileNames,
      allSentences: this.allSentences,
      fullText: this.fullText,
    };
  }

  private isPunctuation(str: string): boolean {
    return str.length === 1 && /\p{P}/u.test(str);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private containsPronounceableChars(str: string): boolean {
    return /[\p{L}\p{N}]/u.test(str);
  }
}
