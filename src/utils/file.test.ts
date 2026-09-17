import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, parseDictionary, sanitizeFilename } from './file';

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
    expect(sanitizeFilename('CON.txt')).toBe('CON.txt'); // Only a bare reserved name gets the prefix.
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

describe('parseDictionary', () => {
  it('should split rules per line, skipping blank lines and # comments', () => {
    expect(parseDictionary('hello->hi\n\n# comment\nworld->earth\n')).toEqual([
      'hello->hi',
      'world->earth',
    ]);
  });

  it('should drop whitespace-only lines', () => {
    expect(parseDictionary('a\n   \nb')).toEqual(['a', 'b']);
  });

  it('should keep indented comment lines as rules', () => {
    expect(parseDictionary('  # kept')).toEqual(['  # kept']);
  });

  it('should return empty for blank or comment-only input', () => {
    expect(parseDictionary('\n\n# only\n   \n')).toEqual([]);
  });
});

describe('downloadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should download a string with the given mime and revoke the object URL', () => {
    downloadFile('content', 'out.txt', 'text/plain');

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should default string mime to text/plain', () => {
    downloadFile('content', 'out.txt');

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain');
  });

  it('should pass a Blob through with its own type', () => {
    const blob = new Blob(['x'], { type: 'application/json' });
    downloadFile(blob, 'data.json');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });
});
