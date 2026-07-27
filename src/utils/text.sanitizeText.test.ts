import { describe, expect, it } from 'vitest';

import { sanitizeText } from './text';

describe('sanitizeText', () => {
  describe('decorative character runs', () => {
    it('replaces underscores with pause marker', () => {
      expect(sanitizeText('_____________________')).toBe('...');
      expect(sanitizeText('___')).toBe('...');
      expect(sanitizeText('text _____ more text')).toBe('text ... more text');
    });

    it('replaces macrons with pause marker', () => {
      expect(sanitizeText('¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯')).toBe('...');
      expect(sanitizeText('¯¯¯')).toBe('...');
      expect(sanitizeText('text ¯¯¯¯¯¯ more text')).toBe('text ... more text');
    });

    it('replaces asterisks with pause marker', () => {
      expect(sanitizeText('***')).toBe('...');
      expect(sanitizeText('******')).toBe('...');
      expect(sanitizeText('text *** more text')).toBe('text ... more text');
    });

    it('replaces tildes with pause marker', () => {
      expect(sanitizeText('~~~')).toBe('...');
      expect(sanitizeText('text ~~~~~ more text')).toBe('text ... more text');
    });

    it('replaces equals signs with pause marker', () => {
      expect(sanitizeText('===')).toBe('...');
      expect(sanitizeText('text ===== more text')).toBe('text ... more text');
    });

    it('replaces dashes with pause marker', () => {
      expect(sanitizeText('---')).toBe('...');
      expect(sanitizeText('text ------ more text')).toBe('text ... more text');
    });

    it('replaces bullets (•) with pause marker', () => {
      expect(sanitizeText('•••')).toBe('...');
      expect(sanitizeText('text ••••• more text')).toBe('text ... more text');
    });

    it('replaces middle dots (·) with pause marker', () => {
      expect(sanitizeText('···')).toBe('...');
      expect(sanitizeText('text ····· more text')).toBe('text ... more text');
    });

    it('replaces box drawing characters with pause marker', () => {
      expect(sanitizeText('───')).toBe('...');
      expect(sanitizeText('═══')).toBe('...');
      expect(sanitizeText('text ─── more text')).toBe('text ... more text');
      expect(sanitizeText('text ════ more text')).toBe('text ... more text');
    });

    it('handles mixed decorative characters', () => {
      expect(sanitizeText('¯_¯_¯')).toBe('...');
      expect(sanitizeText('*~*~*~*')).toBe('...');
    });

    it('preserves single decorative characters', () => {
      expect(sanitizeText('_')).toBe('_');
      expect(sanitizeText('*')).toBe('*');
      expect(sanitizeText('~')).toBe('~');
      expect(sanitizeText('-')).toBe('-');
    });

    it('preserves pairs of decorative characters', () => {
      expect(sanitizeText('__')).toBe('__');
      expect(sanitizeText('**')).toBe('**');
      expect(sanitizeText('~~')).toBe('~~');
      expect(sanitizeText('--')).toBe('--');
    });

    it('handles litRPG stat block patterns from real book', () => {
      const input = `             Suddenly, a glowing line of blue text blue appeared before his eyes.

             ___________________

             You have been injected with Valkyrie!

             +1 Endurance

             You have learnt a new ability: Concentration

             ¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯`;

      const expected = `Suddenly, a glowing line of blue text blue appeared before his eyes.

...

You have been injected with Valkyrie!

+1 Endurance

You have learnt a new ability: Concentration

...`;

      const actual = sanitizeText(input);
      // Replace leading whitespace in both for comparison since original has indentation
      const normalize = (s: string) =>
        s
          .split('\n')
          .map((l) => l.trimStart())
          .join('\n');
      expect(normalize(actual)).toBe(expected);
    });
  });

  describe('markdown headers', () => {
    it('strips markdown headers', () => {
      expect(sanitizeText('# Header')).toBe('Header');
      expect(sanitizeText('## Header')).toBe('Header');
      expect(sanitizeText('### Header')).toBe('Header');
      expect(sanitizeText('text\n## Header\nmore text')).toBe('text\nHeader\nmore text');
    });
  });

  describe('markdown bold/italic', () => {
    it('strips markdown formatting', () => {
      expect(sanitizeText('***bold italic***')).toBe('bold italic');
      expect(sanitizeText('**bold**')).toBe('bold');
      expect(sanitizeText('*italic*')).toBe('italic');
      expect(sanitizeText('___bold italic___')).toBe('bold italic');
      expect(sanitizeText('__bold__')).toBe('bold');
      expect(sanitizeText('_italic_')).toBe('italic');
    });

    it('strips standalone asterisks after markdown processing', () => {
      // After markdown stripping, standalone asterisk runs become decorative
      expect(sanitizeText('***')).toBe('...');
      expect(sanitizeText('****')).toBe('...');
      expect(sanitizeText('text *** more text')).toBe('text ... more text');
    });

    it('strips standalone underscores after markdown processing', () => {
      // After markdown stripping, standalone underscore runs become decorative
      expect(sanitizeText('___')).toBe('...');
      expect(sanitizeText('____')).toBe('...');
      expect(sanitizeText('text ___ more text')).toBe('text ... more text');
    });
  });

  describe('strikethrough and inline code', () => {
    it('strips strikethrough', () => {
      expect(sanitizeText('~~deleted~~')).toBe('deleted');
    });

    it('strips inline code', () => {
      expect(sanitizeText('`code`')).toBe('code');
    });
  });

  describe('HTML tags', () => {
    it('strips HTML tags', () => {
      expect(sanitizeText('<p>Hello</p>')).toBe('Hello');
      expect(sanitizeText('<div class="test">Content</div>')).toBe('Content');
      expect(sanitizeText('text <br/> more text')).toBe('text more text');
    });
  });

  describe('special characters', () => {
    it('replaces ampersand with "and"', () => {
      expect(sanitizeText('AT&T')).toBe('AT and T');
      expect(sanitizeText('Johnson & Johnson')).toBe('Johnson and Johnson');
    });

    it('removes special characters', () => {
      expect(sanitizeText('text|more')).toBe('textmore');
      expect(sanitizeText('text\\more')).toBe('textmore');
      expect(sanitizeText('text^more')).toBe('textmore');
    });

    it('collapses multiple spaces', () => {
      expect(sanitizeText('text    more')).toBe('text more');
      expect(sanitizeText('text     more')).toBe('text more');
    });

    it('trims whitespace', () => {
      expect(sanitizeText('  text  ')).toBe('text');
      expect(sanitizeText('\ntext\n')).toBe('text');
    });
  });
});
