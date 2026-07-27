import { describe, expect, it } from 'vitest';
import { hasSpeechSymbols } from './LLMVoiceService';

describe('hasSpeechSymbols', () => {
  describe('unambiguous speech markers', () => {
    it.each<[string, boolean]>([
      ['"Hello," she said.', true],
      ['\u00ABПривет\u00BB', true],
      ['Elle a dit \u00AB bonjour \u00BB', true],
      ['\u2039Hello\u203A', true],
      ['\u2014 Привет, \u2014 сказал он.', true],
      ['\u201CHello,\u201D she said.', true],
      ['\u201EHallo\u201C', true],
      ['\u2018Hello\u2019', true],
    ])('detects %s', (input, expected) => {
      expect(hasSpeechSymbols(input)).toBe(expected);
    });
  });

  describe('contractions (should NOT trigger)', () => {
    it.each<[string, boolean]>([
      ["don't", false],
      ["it's fine", false],
      ["won't work", false],
      ["I'm here", false],
      ["we've done", false],
      ["they're coming", false],
      ["he'd go", false],
      ["she'll win", false],
      ['don\u2019t', false],
      ['it\u2019s fine', false],
      ['won\u2019t work', false],
      ['I\u2019m here', false],
      ['don`t', false],
      ['it`s', false],
      ['don\u02BCt', false],
      ['don\u2032t', false],
      ['don\uFF07t', false],
      ["it's and won't", false],
      ["I'm sure they'll come and we've got time", false],
      ['it\u2019s and won\u2019t and he\u2019d', false],
      ["John's book", false],
      ['John\u2019s book', false],
    ])('ignores %s', (input, expected) => {
      expect(hasSpeechSymbols(input)).toBe(expected);
    });
  });

  describe('actual single-quoted speech (should trigger)', () => {
    it.each<[string, boolean]>([
      ["He said, 'hello'", true],
      ["'Hello,' she said.", true],
      ['He said, \u2018hello\u2019', true],
      ["'Hello there!'", true],
      ['\u2018Hello there!\u2019', true],
      ["She whispered 'goodbye'", true],
    ])('detects %s', (input, expected) => {
      expect(hasSpeechSymbols(input)).toBe(expected);
    });
  });

  describe('mixed content', () => {
    it('detects speech even with contractions present', () => {
      expect(hasSpeechSymbols('She said, "I don\'t know"')).toBe(true);
      expect(hasSpeechSymbols('\u00ABI don\u2019t know\u00BB')).toBe(true);
    });

    it('handles text without any quotes or contractions', () => {
      expect(hasSpeechSymbols('The quick brown fox jumps over the lazy dog.')).toBe(false);
      expect(hasSpeechSymbols('No special characters here')).toBe(false);
    });

    it('handles empty string', () => {
      expect(hasSpeechSymbols('')).toBe(false);
    });

    it('handles Cyrillic contractions (rare but possible)', () => {
      // Ukrainian uses apostrophe: п'ять (five)
      expect(hasSpeechSymbols("п'ять")).toBe(false);
      expect(hasSpeechSymbols('п\u2019ять')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles apostrophe at start of string (archaic)', () => {
      // 'twas = it was - apostrophe at start is speech-like
      expect(hasSpeechSymbols("'twas the night")).toBe(true);
    });

    it('handles apostrophe at end of word (dropped g) - detected as potential speech', () => {
      // waitin' - ambiguous: could be dropped-g OR unclosed quote
      // We err on the side of detecting speech (safer for audiobooks)
      expect(hasSpeechSymbols("waitin'")).toBe(true);
    });

    it('handles consecutive apostrophes', () => {
      expect(hasSpeechSymbols("''quoted''")).toBe(true);
    });

    it('handles numbers with prime (minutes/feet)', () => {
      // 5′10″ - has double prime which is " (detected)
      expect(hasSpeechSymbols('5\u203210\u2033')).toBe(true);
    });
  });
});
