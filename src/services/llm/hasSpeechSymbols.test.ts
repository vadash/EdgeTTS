import { describe, expect, it } from 'vitest';
import { hasSpeechSymbols } from './LLMVoiceService';

describe('hasSpeechSymbols', () => {
  describe('unambiguous speech markers', () => {
    it('detects straight double quotes', () => {
      expect(hasSpeechSymbols('"Hello," she said.')).toBe(true);
    });

    it('detects guillemets (U+00AB, U+00BB)', () => {
      expect(hasSpeechSymbols('\u00ABПривет\u00BB')).toBe(true);
      expect(hasSpeechSymbols('Elle a dit \u00AB bonjour \u00BB')).toBe(true);
    });

    it('detects single guillemets (U+2039, U+203A)', () => {
      expect(hasSpeechSymbols('\u2039Hello\u203A')).toBe(true);
    });

    it('detects em dash (U+2014 - Russian dialogue style)', () => {
      expect(hasSpeechSymbols('\u2014 Привет, \u2014 сказал он.')).toBe(true);
    });

    it('detects curly double quotes (U+201C, U+201D)', () => {
      expect(hasSpeechSymbols('\u201CHello,\u201D she said.')).toBe(true);
    });

    it('detects low double quote (U+201E)', () => {
      expect(hasSpeechSymbols('\u201EHallo\u201C')).toBe(true);
    });

    it('detects left single quote (U+2018 - opening quote)', () => {
      expect(hasSpeechSymbols('\u2018Hello\u2019')).toBe(true);
    });
  });

  describe('contractions (should NOT trigger)', () => {
    it('ignores straight apostrophe in contractions', () => {
      expect(hasSpeechSymbols("don't")).toBe(false);
      expect(hasSpeechSymbols("it's fine")).toBe(false);
      expect(hasSpeechSymbols("won't work")).toBe(false);
      expect(hasSpeechSymbols("I'm here")).toBe(false);
      expect(hasSpeechSymbols("we've done")).toBe(false);
      expect(hasSpeechSymbols("they're coming")).toBe(false);
      expect(hasSpeechSymbols("he'd go")).toBe(false);
      expect(hasSpeechSymbols("she'll win")).toBe(false);
    });

    it('ignores curly apostrophe (U+2019) in contractions', () => {
      expect(hasSpeechSymbols('don\u2019t')).toBe(false);
      expect(hasSpeechSymbols('it\u2019s fine')).toBe(false);
      expect(hasSpeechSymbols('won\u2019t work')).toBe(false);
      expect(hasSpeechSymbols('I\u2019m here')).toBe(false);
    });

    it('ignores backtick in contractions', () => {
      expect(hasSpeechSymbols('don`t')).toBe(false);
      expect(hasSpeechSymbols('it`s')).toBe(false);
    });

    it('ignores modifier letter apostrophe (U+02BC)', () => {
      expect(hasSpeechSymbols('don\u02BCt')).toBe(false);
    });

    it('ignores prime (U+2032)', () => {
      expect(hasSpeechSymbols('don\u2032t')).toBe(false);
    });

    it('ignores fullwidth apostrophe (U+FF07)', () => {
      expect(hasSpeechSymbols('don\uFF07t')).toBe(false);
    });

    it('handles multiple contractions in one line', () => {
      expect(hasSpeechSymbols("it's and won't")).toBe(false);
      expect(hasSpeechSymbols("I'm sure they'll come and we've got time")).toBe(false);
      expect(hasSpeechSymbols('it\u2019s and won\u2019t and he\u2019d')).toBe(false);
    });

    it('handles possessives', () => {
      expect(hasSpeechSymbols("John's book")).toBe(false);
      expect(hasSpeechSymbols('John\u2019s book')).toBe(false);
    });
  });

  describe('actual single-quoted speech (should trigger)', () => {
    it('detects single-quoted speech with straight quotes', () => {
      expect(hasSpeechSymbols("He said, 'hello'")).toBe(true);
      expect(hasSpeechSymbols("'Hello,' she said.")).toBe(true);
    });

    it('detects single-quoted speech with curly quotes', () => {
      // Opening quote U+2018 is always speech (not used in contractions)
      expect(hasSpeechSymbols('He said, \u2018hello\u2019')).toBe(true);
    });

    it('detects speech at start of line', () => {
      expect(hasSpeechSymbols("'Hello there!'")).toBe(true);
      expect(hasSpeechSymbols('\u2018Hello there!\u2019')).toBe(true);
    });

    it('detects speech at end of line', () => {
      expect(hasSpeechSymbols("She whispered 'goodbye'")).toBe(true);
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
