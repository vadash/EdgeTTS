import { describe, it, expect } from 'vitest';
import { detectLanguage } from './languageDetection';

describe('languageDetection', () => {
  describe('detectLanguage', () => {
    it('should detect English text', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      expect(detectLanguage(text)).toBe('en');
    });

    it('should detect Russian text', () => {
      const text = 'Привет, как дела? Это русский текст.';
      expect(detectLanguage(text)).toBe('ru');
    });

    it('should detect English when mixed with more Latin characters', () => {
      const text = 'Hello мир! How are you doing today?';
      expect(detectLanguage(text)).toBe('en');
    });

    it('should detect Russian when mixed with more Cyrillic characters', () => {
      const text = 'Привет world! Как дела today?';
      expect(detectLanguage(text)).toBe('ru');
    });

    it('should default to English for empty text', () => {
      expect(detectLanguage('')).toBe('en');
      expect(detectLanguage('   ')).toBe('en');
    });

    it('should handle text with only punctuation', () => {
      const text = '!@#$%^&*()_+{}[]|:;<>,.?/~`';
      expect(detectLanguage(text)).toBe('en');
    });

    it('should handle text with numbers', () => {
      const text = '1234567890';
      expect(detectLanguage(text)).toBe('en');
    });

    it('should detect English in typical book content', () => {
      const text = `Chapter 1: The Beginning

      Once upon a time, in a land far away, there lived a young programmer who loved to code.
      They spent their days writing tests and building amazing applications.`;
      expect(detectLanguage(text)).toBe('en');
    });

    it('should detect Russian in typical book content', () => {
      const text = `Глава 1: Начало

      Давным-давно, в далекой стране, жил молодой программист, который любил писать код.
      Он проводил дни, создавая тесты и разрабатывая удивительные приложения.`;
      expect(detectLanguage(text)).toBe('ru');
    });
  });
});
