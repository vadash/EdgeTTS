import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './file';

describe('sanitizeFilename', () => {
  it('should replace invalid characters with underscores', () => {
    expect(sanitizeFilename('Book: Subtitle')).toBe('Book_ Subtitle');
    expect(sanitizeFilename('file<name>test')).toBe('file_name_test');
    expect(sanitizeFilename('test/path\\file')).toBe('test_path_file');
    expect(sanitizeFilename('file|name?test')).toBe('file_name_test');
    expect(sanitizeFilename('test*file"name')).toBe('test_file_name');
  });

  it('should remove leading/trailing dots and spaces', () => {
    expect(sanitizeFilename('  filename  ')).toBe('filename');
    expect(sanitizeFilename('..filename..')).toBe('filename');
    expect(sanitizeFilename(' . filename . ')).toBe('filename');
  });

  it('should handle Windows reserved names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('PRN')).toBe('_PRN');
    expect(sanitizeFilename('AUX')).toBe('_AUX');
    expect(sanitizeFilename('NUL')).toBe('_NUL');
    expect(sanitizeFilename('COM1')).toBe('_COM1');
    expect(sanitizeFilename('LPT5')).toBe('_LPT5');
    expect(sanitizeFilename('CON.txt')).toBe('CON.txt'); // Should not prefix if has extension
  });

  it('should return "untitled" for empty or whitespace-only input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename('   ')).toBe('untitled');
    expect(sanitizeFilename('...')).toBe('untitled');
  });

  it('should handle control characters', () => {
    expect(sanitizeFilename('file\x00name')).toBe('file_name');
    expect(sanitizeFilename('test\x1Fname')).toBe('test_name');
  });

  it('should handle mixed invalid characters', () => {
    expect(sanitizeFilename('Book: "Part 1" <Draft>')).toBe('Book_ _Part 1_ _Draft_');
  });

  it('should preserve valid characters', () => {
    expect(sanitizeFilename('My Book - Chapter 1')).toBe('My Book - Chapter 1');
    expect(sanitizeFilename('file_name.txt')).toBe('file_name.txt');
    expect(sanitizeFilename('日本語ファイル')).toBe('日本語ファイル');
  });
});
