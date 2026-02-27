import { describe, it, expect } from 'vitest';
import { detectLanguage } from './languageDetection';

describe('languageDetection', () => {
  describe('detectLanguage', () => {
    it('should detect English text', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian text', () => {
      const text = 'Привет, как дела? Это русский текст.';
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should detect English when mixed with more Latin characters', () => {
      const text = 'Hello мир! How are you doing today?';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian when mixed with more Cyrillic characters', () => {
      const text = 'Привет world! Как дела today?';
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should default to English for empty text', () => {
      expect(detectLanguage('').language).toBe('en');
      expect(detectLanguage('   ').language).toBe('en');
    });

    it('should handle text with only punctuation', () => {
      const text = '!@#$%^&*()_+{}[]|:;<>,.?/~`';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should handle text with numbers', () => {
      const text = '1234567890';
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect English in typical book content', () => {
      const text = `Chapter 1: The Beginning

      Once upon a time, in a land far away, there lived a young programmer who loved to code.
      They spent their days writing tests and building amazing applications.`;
      expect(detectLanguage(text).language).toBe('en');
    });

    it('should detect Russian in typical book content', () => {
      const text = `Глава 1: Начало

      Давным-давно, в далекой стране, жил молодой программист, который любил писать код.
      Он проводил дни, создавая тесты и разрабатывая удивительные приложения.`;
      expect(detectLanguage(text).language).toBe('ru');
    });

    it('should detect German text', () => {
      const text = 'Der Mann ging mit seinem Hund in den Park und die Kinder spielten auf der Wiese.';
      expect(detectLanguage(text).language).toBe('de');
    });

    it('should detect Japanese text (Hiragana/Katakana)', () => {
      const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
      expect(detectLanguage(text).language).toBe('ja');
    });

    it('should detect Korean text (Hangul)', () => {
      const text = '옛날 옛적에 한 마을에 착한 소년이 살고 있었습니다.';
      expect(detectLanguage(text).language).toBe('ko');
    });

    it('should detect Chinese text (CJK)', () => {
      const text = '从前有一个小村庄，村庄里住着一位老人和他的孙子。';
      expect(detectLanguage(text).language).toBe('zh');
    });

    it('should detect Thai text', () => {
      const text = 'กาลครั้งหนึ่งนานมาแล้ว มีชายหนุ่มคนหนึ่งอาศัยอยู่ในหมู่บ้านเล็กๆ';
      expect(detectLanguage(text).language).toBe('th');
    });

    it('should detect Greek text', () => {
      const text = 'Μια φορά και έναν καιρό ζούσε ένας νεαρός σε ένα μικρό χωριό.';
      expect(detectLanguage(text).language).toBe('el');
    });

    it('should detect Hebrew text', () => {
      const text = 'פעם היה ילד קטן שגר בכפר קטן ליד הים הגדול.';
      expect(detectLanguage(text).language).toBe('he');
    });

    it('should detect Georgian text', () => {
      const text = 'იყო და არა იყო რა, იყო ერთი პატარა სოფელი მთებში.';
      expect(detectLanguage(text).language).toBe('ka');
    });

    it('should detect Bengali text', () => {
      const text = 'একসময় এক ছোট্ট গ্রামে এক বৃদ্ধ লোক বাস করত।';
      expect(detectLanguage(text).language).toBe('bn');
    });

    it('should detect Tamil text', () => {
      const text = 'ஒரு காலத்தில் ஒரு சிறிய கிராமத்தில் ஒரு முதியவர் வாழ்ந்தார்.';
      expect(detectLanguage(text).language).toBe('ta');
    });

    it('should return high confidence for unique-script languages', () => {
      const text = 'むかしむかし、あるところにおじいさんとおばあさんがいました。';
      expect(detectLanguage(text).confidence).toBe('high');
      expect(detectLanguage(text).method).toBe('script');
    });
  });
});
